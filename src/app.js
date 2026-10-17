// createServer(): the store, auth, generator queue, bake queue, frames cache, API and static files
// wired into one node:http server.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApi, createLog, enqueueIdea, MAX_IDEAS_PER_DAY, splitUrl } from './api.js';
import { createAuth } from './auth.js';
import { createBakeQueue, createLane } from './bake.js';
import { createFramesCache } from './frames-cache.js';
import { createQueue } from './generate/index.js';
import { createRenderBox } from './render-box.js';
import { applySecurityHeaders, createLoaders, createStatic, DEFAULT_PUBLIC_DIR } from './static.js';
import { createStore } from './store.js';

export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));

/**
 * createServer({ dataDir, publicDir, generator?, generatorName?, curators?, secureCookies?, rateLimit?,
 *   trustProxy?, log?, maxIdeasPerDay?, renderBox?, framesQuality?, framesMaxBytes? }) → { server, store, auth,
 *   queue, bakes, frames, loaders,
 *   adapterName, handler, listen(port = 0, host = '127.0.0.1') → address, close() }.
 * `generator`: a queue `{ enqueue(idea), idle?() }` or a factory of one (tests), else createQueue().
 * `renderBox`: `{ probe(), render({ layers }), stop?(), config? }` (tests), else createRenderBox() (STUDIO_BAKE_*).
 */
export async function createServer(opts = {}) {
  const {
    dataDir = DEFAULT_DATA_DIR, publicDir = DEFAULT_PUBLIC_DIR, generator, generatorName = 'sketch', curators = [],
    secureCookies = false, rateLimit, trustProxy = false, maxIdeasPerDay = MAX_IDEAS_PER_DAY, log = createLog(),
    renderBox, framesQuality, framesMaxBytes,
  } = opts;

  const store = await createStore(dataDir, { log });
  const auth = createAuth({ store, curators, secureCookies, rateLimit, trustProxy });
  auth.pruneSessions();
  const loaders = createLoaders(publicDir, { log });
  const { loadLibrary, loadGroups } = loaders;
  const deps = { store, loadLibrary, loadGroups, adapterName: generatorName, log };
  const queue = typeof generator === 'function' ? await generator(deps) : generator || createQueue(deps);
  const adapterName = typeof queue.adapterName === 'string' && queue.adapterName ? queue.adapterName : generatorName;
  const framesDir = path.join(dataDir, 'frames');
  const box = renderBox || createRenderBox({ publicDir, log });
  // Baked frames are encoded for streaming as soon as they are stored (src/frames-cache.js); bakes and those
  // encodes take turns at low priority, and frames evicted for the disk cap are baked again on demand.
  const lane = createLane();
  const frames = createFramesCache({ framesDir, store, log, quality: framesQuality, maxBytes: framesMaxBytes, lane,
    rebake: (look) => bakes.restore(look) });
  const cathedralFile = path.join(publicDir, 'data', 'cathedral.json');
  const bakes = createBakeQueue({ store, box, framesDir, cathedralFile, log, lane,
    onFrames: (id) => frames.encode(id) });
  const api = createApi({ store, auth, queue, adapterName, loaders, log, trustProxy, maxIdeasPerDay, framesDir, bakes,
    frames });
  frames.prune().then(() => frames.disk.enforce()).catch(() => {});
  const serveStatic = createStatic({ publicDir, log });
  // Ideas a restart cut short go back in the queue (enqueue is idempotent per id).
  for (const idea of store.ideas.list((i) => i.status === 'queued' || i.status === 'generating')) {
    enqueueIdea({ queue, store, log }, idea);
  }

  async function handler(req, res) {
    applySecurityHeaders(res);
    const url = splitUrl(req.url);
    if (!url) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Bad request'); }
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) await api(req, res, url.pathname, url.query);
      else await serveStatic(req, res, url.pathname);
    } catch (err) {
      log.error?.(`${req.method} ${url.pathname}:`, err);
      if (res.headersSent) return res.destroy();
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal server error');
    }
  }

  const server = http.createServer(handler);
  server.requestTimeout = 60_000;
  server.headersTimeout = 30_000;
  const pruneTimer = setInterval(() => auth.pruneSessions(), 60 * 60 * 1000);
  pruneTimer.unref();

  return {
    server, store, auth, queue, bakes, frames, loaders, adapterName, handler,
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve(server.address());
        });
      });
    },
    async close() {
      clearInterval(pruneTimer);
      if (server.listening) {
        await new Promise((resolve) => {
          server.close(() => resolve());
          server.closeIdleConnections();
        });
      }
      bakes.stop();
      if (typeof queue.idle === 'function') {
        let timer;
        const giveUp = new Promise((r) => (timer = setTimeout(r, 5000)).unref());
        const idle = Promise.all([Promise.resolve(queue.idle()).catch(() => {}), bakes.idle(), frames.idle()]);
        await Promise.race([idle, giveUp]);
        clearTimeout(timer);
      }
      await frames.close();
      await store.flush();
    },
  };
}
