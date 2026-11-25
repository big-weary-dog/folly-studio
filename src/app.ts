// createServer(): the store, auth, bake queue, frames cache, the API (/api) and the built app (/), on one Fastify
// server.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { apiRoutes } from './api.ts';
import { upgradeStored } from './api-looks.ts';
import { type Cost, createAuth } from './auth.ts';
import { createBakeQueue, createLane } from './bake.ts';
import { createBakingStore, governBox } from './baking.ts';
import { createCodeGate } from './library-gate.ts';
import { flashSettings } from './box-output.ts';
import { type Config, configOf } from './config.ts';
import { createFramesCache } from './frames-cache.ts';
import { createLog, errorHandler, keepTail, type Log } from './http.ts';
import { createLightStore } from './light.ts';
import { libraryRefs } from './library-refs.ts';
import { rigFileOf, rigOf } from './rig-choice.ts';
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
import type { RigName } from '../shared/schemas/rig.ts';

export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));
export const MAX_BODY = 256 * 1024;

type Options = { config?: Config, dataDir?: string, publicDir?: string, distDir?: string,
  curators?: string | string[], admins?: string | string[], secureCookies?: boolean, trustProxy?: boolean, log?: Log,
  rateLimit?: { max?: number, ipMax?: number, guestMax?: number, windowMs?: number, writeMax?: number }, scrypt?: Cost,
  framesQuality?: number, framesMaxBytes?: number, renderBox?: Parameters<typeof createBakeQueue>[0]['box'],
  flash?: FlashSettings, previews?: string, rig?: RigName,
  reports?: { keep?: number, maxBytes?: number, days?: number } };

/**
 * The server. `config`: the settings (src/config.ts; default: the environment's), the default of every option below
 * that names one. `renderBox` stands in for createRenderBox() (STUDIO_BAKE_*) in tests;
 * `publicDir`: the sources (the library, the rig); `distDir`: the app as Vite built it, served as static files.
 * `trustProxy`: one proxy in front (a tunnel): the client's address and host are the ones it forwards. `flash`: the
 * flash check's settings (default: flashSettings(config));
 * `previews`: the gallery previews' camera, 'playa' or 'front' (STUDIO_PREVIEWS; default playa).
 * `rig`: 'folly' or 'cog' (STUDIO_RIG; default: the Folly), the rig it shows, bakes and boxes (SPEC "Rig").
 */
export async function createServer(opts: Options = {}) {
  const config = opts.config ?? configOf(process.env);
  const {
    dataDir = DEFAULT_DATA_DIR, publicDir = DEFAULT_PUBLIC_DIR, distDir = DEFAULT_DIST_DIR,
    curators = [], admins = [], secureCookies = false, rateLimit, trustProxy = false,
    renderBox, framesQuality, framesMaxBytes, scrypt,
    flash = flashSettings(config),
  } = opts;
  // Its last warn and error lines go with each bug report.
  const log = keepTail(opts.log ?? createLog());
  const rig = opts.rig ?? rigOf(config), rigFile = rigFileOf(publicDir, rig);

  const loaders = createLoaders(publicDir, { log, rigFile });
  // A look's code is its modules' library files, never what is stored (SPEC-looks "Modules").
  const views = { looks: libraryRefs(loaders.loadLibrary, path.join(publicDir, 'patterns', 'history.json')) };
  const store = await createStore(dataDir, { log, upgrade: { looks: upgradeStored }, views });
  const auth = createAuth({ store, curators, admins, cost: scrypt });
  auth.pruneSessions();
  const { loadRig } = loaders;
  const light = createLightStore({ file: path.join(dataDir, 'light.json'), log });
  const box = renderBox || createRenderBox({ publicDir, rigFile, log, config });
  // Bakes and previews go through the admin's bake setting.
  const baking = createBakingStore({ file: path.join(dataDir, 'baking.json'), log });
  const bakeBox = governBox(box, baking.mode);
  const codeGate = createCodeGate({ patternsDir: path.join(publicDir, 'patterns') });
  // Baked frames are encoded for streaming as soon as they are stored (src/frames-cache.ts); bakes and those
  // encodes take turns at low priority, and evicted frames are baked again on demand.
  const lane = createLane();
  const reports = createReports({ dir: path.join(dataDir, 'reports'), ...opts.reports, log });
  void reports.sweep();
  const framesDir = path.join(dataDir, 'frames');
  const frames = createFramesCache({ framesDir, store, log, quality: framesQuality, maxBytes: framesMaxBytes, lane,
    rebake: (look) => bakes.restore(look) });
  const bakes = createBakeQueue({ store, box: bakeBox, framesDir, rigFile, log, lane, flash, loadLight: light.current,
    onFrames: (id) => { frames.encode(id); previews.want(id); } });
  frames.prune().then(() => frames.disk.enforce()).catch(() => {});
  // Gallery previews (SPEC-previews), made in the same lane, after anything already queued at start.
  const playa = (opts.previews ?? config.STUDIO_PREVIEWS) === 'front' ? null
    : playaCamera({ log, loadLight: light.current });
  const previews = createPreviews({ dir: path.join(dataDir, 'previews'), store, box: bakeBox, framesDir, lane, log,
    loadRig, camera: playa?.camera ?? frontView() });
  const previewBackfill = previews.backfill().catch((err) => log.error?.('[previews] backfill:', err));

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
  const stats = createStats({ log, store, trustProxy });
  app.addHook('onResponse', stats.onResponse);
  app.addHook('onRequest', async (req, reply) => {
    reply.headers({ 'content-security-policy': CSP_APP, 'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin' });
  });
  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });
  await app.register(apiRoutes({ store, auth, loaders, log, framesDir, bakes,
    frames, rateLimit, secureCookies, flash, previews, reports, light, rig,
    baking: { baking, box }, codeGate, stats: stats.routes,
    build: buildSha(path.dirname(fileURLToPath(import.meta.url)), config.GIT_SHA), tail: log.tail }),
  { prefix: '/api' });
  await serveApp(app, { distDir, log });
  await app.ready();
  const pruneTimer = setInterval(() => { auth.pruneSessions(); void reports.sweep(); }, 60 * 60 * 1000);
  pruneTimer.unref();

  return {
    app, server: app.server, store, auth, bakes, frames, previews, loaders,
    async listen(port = 0, host = '127.0.0.1') {
      await app.listen({ port, host });
      return app.server.address() as { port: number, address: string, family: string };
    },
    async close() {
      clearInterval(pruneTimer);
      await app.close();
      bakes.stop();
      previews.stop();
      // Preview encodes and atomic writes must finish before storage closes or the process exits.
      await previewBackfill;
      await previews.idle();
      await playa?.close();
      await frames.close();
      await store.close();
    },
  };
}
