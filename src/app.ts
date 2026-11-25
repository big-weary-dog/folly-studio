// createServer(): the store, auth, generator queue, bake queue, frames cache, the API (/api) and the built app (/),
// on one Fastify server.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { createAccess } from './access.ts';
import { apiRoutes, enqueueIdea } from './api.ts';
import { upgradeStored } from './api-looks.ts';
import { isPending } from '../shared/idea-status.ts';
import type { Idea } from '../shared/schemas/api.ts';
import { type Cost, createAuth } from './auth.ts';
import { createBakeQueue, createLane } from './bake.ts';
import { createBakingStore, governBox } from './baking.ts';
import { createCodeGate } from './custom-code.ts';
import { flashSettings } from './box-output.ts';
import { type Config, configOf } from './config.ts';
import { createFramesCache } from './frames-cache.ts';
import { createQueue, foundryOf } from './generate/index.ts';
import { createIdeaLogs } from './generate/idea-log.ts';
import { createRegistry } from './generate/models.ts';
import { createLog, errorHandler, keepTail, type Log } from './http.ts';
import { createLightStore } from './light.ts';
import { createPreviews } from './previews/index.ts';
import { frontView } from './previews/motion.ts';
import { playaCamera } from './previews/playa.ts';
import { createRenderBox } from './render-box.ts';
import { createStats } from './stats.ts';
import { buildSha } from './reports/build.ts';
import { createReports } from './reports/store.ts';
import { createLoaders, CSP_APP, DEFAULT_DIST_DIR, DEFAULT_PUBLIC_DIR, serveApp } from './static.ts';
import { createStore } from './store.ts';
import type { FlashSettings } from '../shared/schemas/api.ts';

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
  rateLimit?: { max?: number, ipMax?: number, guestMax?: number, windowMs?: number }, scrypt?: Cost,
  framesQuality?: number, framesMaxBytes?: number, generator?: Queue | ((deps: Deps) => Queue | Promise<Queue>),
  renderBox?: Parameters<typeof createBakeQueue>[0]['box'], flash?: FlashSettings,
  ideaLogs?: { keep?: number, maxBytes?: number }, previews?: string,
  reports?: { keep?: number, maxBytes?: number, days?: number }, generators?: boolean, customCode?: boolean };

/**
 * The server. `config`: the settings (src/config.ts; default: models.env's, else the environment's), the default of
 * every option below that names one. `generator` and `renderBox` stand in for createQueue() and createRenderBox()
 * (STUDIO_BAKE_*) in tests;
 * `generatorName`: STUDIO_GENERATOR, the registry's default when its file is first written ('' when unset);
 * `publicDir`: the sources (the library, the rig); `distDir`: the app as Vite built it, served as static files.
 * `trustProxy`: one proxy in front (a tunnel): the client's address and host are the ones it forwards. `flash`: the
 * flash check's settings (default: flashSettings(config));
 * `ideaLogs`: how many ideas' logs to keep and their disk cap (STUDIO_IDEA_LOGS, STUDIO_IDEA_LOGS_MAX_BYTES);
 * `previews`: the gallery previews' camera, 'playa' or 'front' (STUDIO_PREVIEWS; default playa).
 * `generators`, `customCode`: tests only (no setting, file or route reaches them), to run the generators and save and
 * bake code that is not the library's; production has neither (SPEC-generators "No generators", SPEC-baking "Custom
 * code"). They go with the generators and the custom code they test.
 */
export async function createServer(opts: Options = {}) {
  const env = opts.models?.env ?? process.env, codexBin = opts.models?.codexBin;
  const config = opts.config ?? configOf(env);
  const {
    dataDir = DEFAULT_DATA_DIR, publicDir = DEFAULT_PUBLIC_DIR, distDir = DEFAULT_DIST_DIR, generator,
    generatorName = '', curators = [], admins = [], secureCookies = false, rateLimit, trustProxy = false,
    renderBox, framesQuality, framesMaxBytes, scrypt,
    flash = flashSettings(config),
  } = opts;
  // Its last warn and error lines go with each bug report.
  const log = keepTail(opts.log ?? createLog());

  const store = await createStore(dataDir, { log, upgrade: { looks: upgradeStored } });
  const auth = createAuth({ store, curators, admins, cost: scrypt });
  auth.pruneSessions();
  const loaders = createLoaders(publicDir, { log });
  const { loadLibrary, loadRig } = loaders;
  // Generators run only where a test asks (SPEC-generators "No generators").
  const gen = opts.generators === true;
  const models = gen ? createRegistry({
    file: opts.models?.file || config.STUDIO_MODELS || path.join(dataDir, 'models.json'),
    env, settings: config, log, legacy: generatorName, foundryOn: foundryOf(config).on, codexBin }) : null;
  const access = createAccess({ store, auth, models });
  const light = createLightStore({ file: path.join(dataDir, 'light.json'), log });
  const box = renderBox || createRenderBox({ publicDir, log, config, customCode: opts.customCode });
  // Bakes and previews go through the admin's bake setting; the generators' render checks are not bakes.
  const baking = createBakingStore({ file: path.join(dataDir, 'baking.json'), customCode: opts.customCode, log });
  const bakeBox = governBox(box, baking.mode);
  const codeGate = createCodeGate({ on: baking.customCode, patternsDir: path.join(publicDir, 'patterns') });
  // Baked frames are encoded for streaming as soon as they are stored (src/frames-cache.ts); bakes, those encodes
  // and the generators' render checks take turns at low priority, and evicted frames are baked again on demand.
  const lane = createLane();
  const ideaLogs = createIdeaLogs({ dir: path.join(dataDir, 'ideas-log'), ...opts.ideaLogs, log });
  const reports = createReports({ dir: path.join(dataDir, 'reports'), ...opts.reports, log });
  void reports.sweep();
  const deps = { store, loadLibrary, loadRig, loadLight: light.current, loadVersion: loaders.version, models, codexBin,
    config, log, box, lane, ideaLogs, codeGate, adapterName: generatorName || models?.defaultId() || '' };
  // Without generators nothing can make an idea, so nothing is ever queued.
  const queue: Queue = !models ? { enqueue: () => { throw new Error('No generators.'); } }
    : typeof generator === 'function' ? await generator({ ...deps, models })
      : generator || createQueue({ ...deps, models });
  const adapterName = models?.defaultId() || '';
  const framesDir = path.join(dataDir, 'frames');
  const frames = createFramesCache({ framesDir, store, log, quality: framesQuality, maxBytes: framesMaxBytes, lane,
    rebake: (look) => bakes.restore(look) });
  const rigFile = path.join(publicDir, 'data', 'rig.json');
  const bakes = createBakeQueue({ store, box: bakeBox, framesDir, rigFile, log, lane, flash, loadLight: light.current,
    onFrames: (id) => { frames.encode(id); previews.want(id); } });
  frames.prune().then(() => frames.disk.enforce()).catch(() => {});
  // Gallery previews (SPEC-previews), made in the same lane, after anything already queued at start.
  const playa = (opts.previews ?? config.STUDIO_PREVIEWS) === 'front' ? null
    : playaCamera({ log, loadLight: light.current });
  const previews = createPreviews({ dir: path.join(dataDir, 'previews'), store, box: bakeBox, framesDir, lane, log,
    loadRig, camera: playa?.camera ?? frontView() });
  const previewBackfill = previews.backfill().catch((err) => log.error?.('[previews] backfill:', err));
  // Ideas a restart cut short go back in the queue (enqueue is idempotent per id).
  for (const idea of gen ? store.ideas.list(isPending) : []) {
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
  // A journal line for each request worth reading, and Admin → Stats' counts (src/stats.ts).
  const stats = createStats({ log, store, ideas: gen, trustProxy });
  app.addHook('onResponse', stats.onResponse);
  app.addHook('onRequest', async (req, reply) => {
    reply.headers({ 'content-security-policy': CSP_APP, 'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin' });
  });
  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });
  await app.register(apiRoutes({ store, auth, queue, models, loaders, log, access, framesDir, bakes,
    frames, rateLimit, secureCookies, flash, ideaLogs, previews, reports, light, gen,
    baking: { baking, box }, codeGate, stats: stats.routes,
    build: buildSha(path.dirname(fileURLToPath(import.meta.url)), config.GIT_SHA), tail: log.tail }),
  { prefix: '/api' });
  await serveApp(app, { distDir, log });
  await app.ready();
  const pruneTimer = setInterval(() => { auth.pruneSessions(); void reports.sweep(); }, 60 * 60 * 1000);
  pruneTimer.unref();

  return {
    app, server: app.server, store, auth, access, queue, bakes, frames, previews, loaders, models, adapterName,
    async listen(port = 0, host = '127.0.0.1') {
      await app.listen({ port, host });
      return app.server.address() as { port: number, address: string, family: string };
    },
    async close() {
      // First, so a call the stop cuts is never taken for a failed idea; its idea queues again at the next start.
      queue.stop?.();
      clearInterval(pruneTimer);
      await app.close();
      bakes.stop();
      previews.stop();
      if (typeof queue.idle === 'function') {
        let timer: NodeJS.Timeout | undefined;
        const giveUp = new Promise((r) => (timer = setTimeout(r, 5000)).unref());
        const idle = Promise.all([Promise.resolve(queue.idle()).catch(() => {}), bakes.idle(), frames.idle(),
          previewBackfill]);
        await Promise.race([idle, giveUp]);
        clearTimeout(timer);
      }
      // Preview encodes and atomic writes must finish before storage closes or the process exits.
      await previewBackfill;
      await previews.idle();
      await playa?.close();
      await frames.close();
      await store.close();
    },
  };
}
