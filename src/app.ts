// createServer(): the store, auth, generator queue, bake queue, frames cache, the API (/api) and the built app (/),
// on one Fastify server.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';

import { createAccess } from './access.ts';
import { apiRoutes, enqueueIdea } from './api.ts';
import { upgradeStored } from './api-looks.ts';
import { isPending } from '../shared/idea-status.ts';
import type { Idea } from '../shared/schemas/api.ts';
import { type Cost, createAuth } from './auth.ts';
import { createBakeQueue, createLane } from './bake.ts';
import { flashSettings } from './box-output.ts';
import { type Config, configOf } from './config.ts';
import { createFramesCache } from './frames-cache.ts';
import { createQueue, foundryOf } from './generate/index.ts';
import { createIdeaLogs } from './generate/idea-log.ts';
import { createRegistry } from './generate/models.ts';
import { createLog, errorHandler, keepTail, type Log } from './http.ts';
import { createLightStore } from './light.ts';
import { createHub } from './live/hub.ts';
import { piFeed } from './live/pi-feed.ts';
import { controlFor, liveSettings, playableLook, stageCopy } from './live/routes.ts';
import { createLightsStore } from './lights.ts';
import { piPreview, previewTarget } from './pi-preview.ts';
import { boxDefaults, generates, type Profile, profileDefaults, profileOf } from './profile.ts';
import { createPreviews } from './previews/index.ts';
import { frontView } from './previews/motion.ts';
import { playaCamera } from './previews/playa.ts';
import { createRenderBox } from './render-box.ts';
import { buildSha } from './reports/build.ts';
import { createReports } from './reports/store.ts';
import { createLoaders, CSP_APP, DEFAULT_DIST_DIR, DEFAULT_PUBLIC_DIR, serveApp } from './static.ts';
import { createStore } from './store.ts';
import type { FlashSettings } from '../shared/schemas/api.ts';
import type { LiveSettings } from '../shared/schemas/live.ts';

export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));
export const MAX_BODY = 256 * 1024;

/** The generator queue: createQueue()'s, or one a test gives. */
export type Queue = { enqueue(idea: Idea): unknown, idle?(): unknown, stop?(): void, adapterName?: string,
  watch?(id: string, fn: () => void): () => void };
type Deps = Parameters<typeof createQueue>[0] & { adapterName: string };
/** The model registry's file (default <dataDir>/models.json), the environment it checks, and the codex command. */
type ModelOptions = { file?: string, env?: NodeJS.ProcessEnv, codexBin?: string };
type Options = { config?: Config, dataDir?: string, publicDir?: string, distDir?: string, generatorName?: string,
  curators?: string | string[], admins?: string | string[], models?: ModelOptions, secureCookies?: boolean,
  trustProxy?: boolean, log?: Log,
  rateLimit?: { max?: number, ipMax?: number, windowMs?: number }, scrypt?: Cost, framesQuality?: number,
  framesMaxBytes?: number, generator?: Queue | ((deps: Deps) => Queue | Promise<Queue>),
  renderBox?: Parameters<typeof createBakeQueue>[0]['box'], flash?: FlashSettings, live?: LiveSettings,
  piPreview?: string, ideaLogs?: { keep?: number, maxBytes?: number }, previews?: string,
  reports?: { keep?: number, maxBytes?: number, days?: number }, profile?: Profile };

/**
 * The server. `config`: the settings (src/config.ts; default: models.env's, else the environment's), the default of
 * every option below that names one. `generator` and `renderBox` stand in for createQueue() and createRenderBox()
 * (STUDIO_BAKE_*) in tests;
 * `generatorName`: STUDIO_GENERATOR, the registry's default when its file is first written ('' when unset);
 * `publicDir`: the sources (the library, the rig); `distDir`: the app as Vite built it, served as static files.
 * `trustProxy`: one proxy in front (a tunnel): the client's address and host are the ones it forwards. `flash`: the
 * flash check's settings (default: flashSettings(config)); `live`: who controls the live stage and what plays
 * (default: liveSettings(config)); `piPreview`: PI_PREVIEW_URL, a dry-run Studio Live shown to admins at /pi;
 * `ideaLogs`: how many ideas' logs to keep and their disk cap (STUDIO_IDEA_LOGS, STUDIO_IDEA_LOGS_MAX_BYTES);
 * `previews`: the gallery previews' camera, 'playa' or 'front' (STUDIO_PREVIEWS; default: the profile's).
 * `profile`: 'hosted' or 'pi' (STUDIO_PROFILE, SPEC-offline): the Pi has no generators, and its own defaults.
 */
export async function createServer(opts: Options = {}) {
  const env = opts.models?.env ?? process.env, codexBin = opts.models?.codexBin;
  const config = opts.config ?? configOf(env);
  const {
    dataDir = DEFAULT_DATA_DIR, publicDir = DEFAULT_PUBLIC_DIR, distDir = DEFAULT_DIST_DIR, generator,
    generatorName = '', curators = [], admins = [], secureCookies = false, rateLimit, trustProxy = false,
    renderBox, framesQuality, scrypt, profile = profileOf(config),
    flash = flashSettings(config), live = liveSettings(config),
  } = opts;
  // Its last warn and error lines go with each bug report.
  const log = keepTail(opts.log ?? createLog());
  const piTarget = opts.piPreview ? previewTarget(opts.piPreview) : null;
  const defaults = profileDefaults(profile);
  const framesMaxBytes = opts.framesMaxBytes ?? defaults.framesMaxBytes;

  const store = await createStore(dataDir, { log, upgrade: { looks: upgradeStored } });
  const auth = createAuth({ store, curators, admins, cost: scrypt });
  auth.pruneSessions();
  const loaders = createLoaders(publicDir, { log });
  const { loadLibrary, loadRig } = loaders;
  const models = createRegistry({ file: opts.models?.file || config.STUDIO_MODELS || path.join(dataDir, 'models.json'),
    env, settings: config, log, legacy: generatorName, foundryOn: foundryOf(config).on, codexBin });
  const access = createAccess({ store, auth, models });
  const light = createLightStore({ file: path.join(dataDir, 'light.json'), log });
  const box = renderBox || createRenderBox({ publicDir, log, config, ...boxDefaults(profile, config) });
  // Baked frames are encoded for streaming as soon as they are stored (src/frames-cache.ts); bakes, those encodes
  // and the generators' render checks take turns at low priority, and evicted frames are baked again on demand.
  const lane = createLane();
  const ideaLogs = createIdeaLogs({ dir: path.join(dataDir, 'ideas-log'), ...opts.ideaLogs, log });
  const reports = createReports({ dir: path.join(dataDir, 'reports'), ...opts.reports, log });
  void reports.sweep();
  const deps = { store, loadLibrary, loadRig, loadLight: light.current, loadVersion: loaders.version, models, codexBin,
    config, log, box, lane, ideaLogs, adapterName: generatorName || models.defaultId() };
  // The Pi runs none: nothing can make an idea there, so nothing is ever queued.
  const queue: Queue = !generates(profile) ? { enqueue: () => { throw new Error('No generators on the Pi.'); } }
    : typeof generator === 'function' ? await generator(deps) : generator || createQueue(deps);
  const adapterName = models.defaultId();
  const framesDir = path.join(dataDir, 'frames');
  const frames = createFramesCache({ framesDir, store, log, quality: framesQuality, maxBytes: framesMaxBytes, lane,
    rebake: (look) => bakes.restore(look) });
  const rigFile = path.join(publicDir, 'data', 'rig.json');
  const bakes = createBakeQueue({ store, box, framesDir, rigFile, log, lane, flash, loadLight: light.current,
    onFrames: (id) => { frames.encode(id); previews.want(id); } });
  frames.prune().then(() => frames.disk.enforce()).catch(() => {});
  // Gallery previews (SPEC "Gallery previews"), made in the same lane, after anything already queued at start.
  const playa = (opts.previews ?? config.STUDIO_PREVIEWS ?? defaults.previews) === 'front' ? null
    : playaCamera({ log, loadLight: light.current });
  const previews = createPreviews({ dir: path.join(dataDir, 'previews'), store, box, framesDir, lane, log,
    loadRig, camera: playa?.camera ?? frontView() });
  previews.backfill().catch((err) => log.error?.('[previews] backfill:', err));
  const hub = await createHub({ dataDir, log, playable: (id) => {
    const look = store.looks.get(id);
    if (!look || !playableLook(look, live)) {
      return { error: `Only ${live.looks === 'reviewed' ? 'reviewed' : 'shared'} looks play on the stage.` };
    }
    return stageCopy(look, store.users.get(look.owner)?.username ?? '');
  } });
  // Ideas a restart cut short go back in the queue (enqueue is idempotent per id).
  for (const idea of generates(profile) ? store.ideas.list(isPending) : []) {
    enqueueIdea({ queue, store, log }, idea);
  }

  // Behind a proxy on this machine (the tunnel), X-Forwarded-For's right-most address is the client's: one hop,
  // trusted only from loopback (Fastify no longer trusts a bare hop count). Never `true`: the client writes the
  // left of X-Forwarded-For, and would pick its own login limit.
  const app = Fastify({ logger: false, bodyLimit: MAX_BODY, requestTimeout: 60_000,
    trustProxy: trustProxy ? 'loopback' : false, forceCloseConnections: 'idle' });
  app.server.headersTimeout = 30_000;
  app.setErrorHandler(errorHandler(log));
  // A mutation's empty JSON body is {} (logout, bake); anything else Fastify's own parser (prototype keys refused).
  const json = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => (body.length
    ? json(req, String(body), done) : done(null, {})));
  app.addHook('onRequest', async (req, reply) => {
    reply.headers({ 'content-security-policy': CSP_APP, 'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin' });
  });
  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });
  await app.register(fastifyWebsocket, { options: { maxPayload: 32 * 1024 } });   // a relayed frame (pi-preview.ts)
  // The live stage follows the dry run whenever /pi was the last thing used (SPEC-live "Following /pi"); on the Pi,
  // the feed also plays looks on the lights (SPEC-offline "Playing on the lights").
  // The mode is the admin's on the Pi (lights.json); the hosted dry run at /pi is a preview, in Live Play.
  const lightsStore = profile === 'pi' ? createLightsStore(path.join(dataDir, 'lights.json')) : null;
  const feed = piTarget && piFeed({ target: piTarget, pin: config.PI_PIN, onNow: hub.piNow, onSource: hub.piSource,
    mode: () => lightsStore?.current().mode ?? 'live', log });
  if (feed) app.addHook('onClose', async () => feed.close());
  const drive = controlFor(auth, live);
  const lights = feed && lightsStore ? { store: lightsStore, feed, hub, drive } : undefined;
  await app.register(apiRoutes({ store, auth, queue, models, loaders, log, access, framesDir, bakes,
    frames, rateLimit, secureCookies, flash, hub, live, ideaLogs, previews, reports, light, profile, lights,
    build: buildSha(path.dirname(fileURLToPath(import.meta.url)), config.GIT_SHA), tail: log.tail }),
  { prefix: '/api' });
  if (piTarget) await app.register(piPreview({ auth, target: piTarget, hub, curators: profile === 'pi', drive,
    loadRig }));
  await serveApp(app, { distDir, log });
  await app.ready();
  const pruneTimer = setInterval(() => { auth.pruneSessions(); void reports.sweep(); }, 60 * 60 * 1000);
  pruneTimer.unref();

  return {
    app, server: app.server, store, auth, access, queue, bakes, frames, previews, loaders, models, adapterName, hub,
    async listen(port = 0, host = '127.0.0.1') {
      await app.listen({ port, host });
      return app.server.address() as { port: number, address: string, family: string };
    },
    async close() {
      // First, so a call the stop cuts is never taken for a failed idea; its idea queues again at the next start.
      queue.stop?.();
      clearInterval(pruneTimer);
      await hub.close();
      await app.close();
      bakes.stop();
      previews.stop();
      if (typeof queue.idle === 'function') {
        let timer: NodeJS.Timeout | undefined;
        const giveUp = new Promise((r) => (timer = setTimeout(r, 5000)).unref());
        const idle = Promise.all([Promise.resolve(queue.idle()).catch(() => {}), bakes.idle(), frames.idle(),
          previews.idle()]);
        await Promise.race([idle, giveUp]);
        clearTimeout(timer);
      }
      await playa?.close();
      await frames.close();
      await store.close();
    },
  };
}
