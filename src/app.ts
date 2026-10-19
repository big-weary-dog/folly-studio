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
import type { Idea } from '../shared/schemas/api.ts';
import { type Cost, createAuth } from './auth.ts';
import { createBakeQueue, createLane } from './bake.ts';
import { flashSettings } from './box-output.ts';
import { createFramesCache } from './frames-cache.ts';
import { createQueue, foundryFromEnv } from './generate/index.ts';
import { createRegistry } from './generate/models.ts';
import { createLog, errorHandler, type Log } from './http.ts';
import { createHub } from './live/hub.ts';
import { liveSettings, playableLook, stageCopy } from './live/routes.ts';
import { createRenderBox } from './render-box.ts';
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
type Options = { dataDir?: string, publicDir?: string, distDir?: string, generatorName?: string,
  curators?: string | string[], admins?: string | string[], models?: ModelOptions, secureCookies?: boolean,
  trustProxy?: boolean, log?: Log,
  rateLimit?: { max?: number, ipMax?: number, windowMs?: number }, scrypt?: Cost, framesQuality?: number,
  framesMaxBytes?: number, generator?: Queue | ((deps: Deps) => Queue | Promise<Queue>),
  renderBox?: Parameters<typeof createBakeQueue>[0]['box'], flash?: FlashSettings, live?: LiveSettings };

/**
 * The server. `generator` and `renderBox` stand in for createQueue() and createRenderBox() (STUDIO_BAKE_*) in tests;
 * `generatorName`: STUDIO_GENERATOR, the registry's default when its file is first written ('' when unset);
 * `publicDir`: the sources (the library, the rig); `distDir`: the app as Vite built it, served as static files.
 * `trustProxy`: one proxy in front (a tunnel): the client's address and host are the ones it forwards. `flash`: the
 * flash check's settings (default: flashSettings(process.env)); `live`: who controls the live stage and what plays
 * (default: liveSettings(process.env)).
 */
export async function createServer(opts: Options = {}) {
  const {
    dataDir = DEFAULT_DATA_DIR, publicDir = DEFAULT_PUBLIC_DIR, distDir = DEFAULT_DIST_DIR, generator,
    generatorName = '', curators = [], admins = [], secureCookies = false, rateLimit, trustProxy = false,
    log = createLog(), renderBox, framesQuality, framesMaxBytes, scrypt,
    flash = flashSettings(), live = liveSettings(),
  } = opts;

  const store = await createStore(dataDir, { log, upgrade: { looks: upgradeStored } });
  const auth = createAuth({ store, curators, admins, cost: scrypt });
  auth.pruneSessions();
  const loaders = createLoaders(publicDir, { log });
  const { loadLibrary, loadRig } = loaders;
  const env = opts.models?.env ?? process.env, codexBin = opts.models?.codexBin;
  const models = createRegistry({ file: opts.models?.file || env.STUDIO_MODELS || path.join(dataDir, 'models.json'),
    env, log, legacy: generatorName, foundryOn: foundryFromEnv(env).on, codexBin });
  const access = createAccess({ store, auth, models });
  const deps = { store, loadLibrary, loadRig, loadVersion: loaders.version, models, codexBin, log,
    adapterName: generatorName || 'sketch' };
  const queue: Queue = typeof generator === 'function' ? await generator(deps) : generator || createQueue(deps);
  const adapterName = models.defaultId();
  const framesDir = path.join(dataDir, 'frames');
  const box = renderBox || createRenderBox({ publicDir, log });
  // Baked frames are encoded for streaming as soon as they are stored (src/frames-cache.ts); bakes and those
  // encodes take turns at low priority, and frames evicted for the disk cap are baked again on demand.
  const lane = createLane();
  const frames = createFramesCache({ framesDir, store, log, quality: framesQuality, maxBytes: framesMaxBytes, lane,
    rebake: (look) => bakes.restore(look) });
  const rigFile = path.join(publicDir, 'data', 'rig.json');
  const bakes = createBakeQueue({ store, box, framesDir, rigFile, log, lane, flash,
    onFrames: (id) => frames.encode(id) });
  frames.prune().then(() => frames.disk.enforce()).catch(() => {});
  const hub = await createHub({ dataDir, log, playable: (id) => {
    const look = store.looks.get(id);
    if (!look || !playableLook(look, live)) {
      return { error: `Only ${live.looks === 'reviewed' ? 'reviewed' : 'shared'} looks play on the stage.` };
    }
    return stageCopy(look, store.users.get(look.owner)?.username ?? '');
  } });
  // Ideas a restart cut short go back in the queue (enqueue is idempotent per id).
  for (const idea of store.ideas.list((i) => i.status === 'queued' || i.status === 'generating')) {
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
  await app.register(fastifyWebsocket, { options: { maxPayload: 16 * 1024 } });
  await app.register(apiRoutes({ store, auth, queue, models, loaders, log, access, framesDir, bakes,
    frames, rateLimit, secureCookies, flash, hub, live }), { prefix: '/api' });
  await serveApp(app, { distDir, log });
  await app.ready();
  const pruneTimer = setInterval(() => auth.pruneSessions(), 60 * 60 * 1000);
  pruneTimer.unref();

  return {
    app, server: app.server, store, auth, access, queue, bakes, frames, loaders, models, adapterName, hub,
    async listen(port = 0, host = '127.0.0.1') {
      await app.listen({ port, host });
      return app.server.address() as { port: number, address: string, family: string };
    },
    async close() {
      clearInterval(pruneTimer);
      await hub.close();
      await app.close();
      bakes.stop();
      if (typeof queue.idle === 'function') {
        let timer: NodeJS.Timeout | undefined;
        const giveUp = new Promise((r) => (timer = setTimeout(r, 5000)).unref());
        const idle = Promise.all([Promise.resolve(queue.idle()).catch(() => {}), bakes.idle(), frames.idle()]);
        await Promise.race([idle, giveUp]);
        clearTimeout(timer);
      }
      queue.stop?.(); // calls still running are cut (a codex process with them); their ideas queue again at start
      await frames.close();
      await store.flush();
    },
  };
}
