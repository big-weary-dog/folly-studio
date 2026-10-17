// The HTTP API (see SPEC.md "HTTP API") and createServer(), which wires the store,
// auth, generator queue, API and static files into one node:http server.

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createAuth, HttpError } from './auth.js';
import { applySecurityHeaders, createLoaders, createStatic, DEFAULT_PUBLIC_DIR } from './static.js';

export { HttpError } from './auth.js';
export { createLoaders, loadLibrary, loadGroups, DEFAULT_PUBLIC_DIR } from './static.js';

export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));
export const MAX_BODY = 256 * 1024;
export const MAX_LAYERS = 8;
export const MAX_CODE_BYTES = 20 * 1024;
export const MAX_VERSIONS = 20;
export const MAX_IDEAS_PER_DAY = 20;
export const MAX_LOOKS_PER_USER = 500;
export const GALLERY_LIMIT = 200;
export const BLENDS = ['add', 'over', 'max', 'multiply'];

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DAY_MS = 24 * 60 * 60 * 1000;

/** A logger usable both as log(...) and log.info/warn/error(...). */
export function createLog(prefix = '[studio]') {
  const log = (...a) => console.log(prefix, ...a);
  log.info = log;
  log.debug = () => {};
  log.warn = (...a) => console.warn(prefix, ...a);
  log.error = (...a) => console.error(prefix, ...a);
  return log;
}

// ---------------------------------------------------------------------------
// Request helpers

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const stripDefaultPort = (host) => host.toLowerCase().replace(/:(80|443)$/, '');

/** CSRF: JSON content type, and a same-origin Origin when one is sent. */
function checkMutation(req, trustProxy) {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originHost = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      /* "null" or garbage */
    }
    const fwd = trustProxy && typeof req.headers['x-forwarded-host'] === 'string' ? req.headers['x-forwarded-host'].split(',')[0].trim() : '';
    const host = fwd || req.headers.host || '';
    if (!originHost || !host || stripDefaultPort(originHost) !== stripDefaultPort(host)) {
      throw new HttpError(403, 'Cross-origin request refused.');
    }
  }
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json.');
}

function readJson(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const tooBig = () => new HttpError(413, `Request body is over ${Math.round(max / 1024)} kB.`);
    if (Number(req.headers['content-length']) > max) {
      req.resume(); // discard; node keeps the connection usable
      return reject(tooBig());
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > max) {
        done = true;
        chunks.length = 0;
        reject(tooBig());
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        return reject(new HttpError(400, 'Body is not valid JSON.'));
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return reject(new HttpError(400, 'Body must be a JSON object.'));
      resolve(value);
    });
    req.on('error', (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Validation

const bad = (msg) => {
  throw new HttpError(400, msg);
};
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const isShortString = (v, max = 200) => typeof v === 'string' && v.length <= max;
const LAYER_KEYS = new Set(['id', 'title', 'code', 'groups', 'blend', 'level', 'params']);

function cleanParamValue(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'boolean') return true;
  if (typeof v === 'string') return v.length <= 200;
  if (Array.isArray(v)) return v.length <= 16 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  return false;
}

/** Validates and normalizes a look's layers (defaults: blend add, level 1, groups [cathedral], params {}). */
export function validateLayers(layers) {
  if (!Array.isArray(layers)) bad('layers must be an array.');
  if (layers.length > MAX_LAYERS) bad(`A look can have at most ${MAX_LAYERS} layers.`);
  const ids = new Set();
  return layers.map((l, i) => {
    const at = `Layer ${i + 1}`;
    if (!isPlainObject(l)) bad(`${at} must be an object.`);
    if (typeof l.code !== 'string') bad(`${at}: code must be a string.`);
    if (Buffer.byteLength(l.code) > MAX_CODE_BYTES) bad(`${at}: code is over ${MAX_CODE_BYTES / 1024} kB.`);

    const id = l.id ?? `l${i + 1}`;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(id)) bad(`${at}: id must be 1–64 letters, digits or _.:-`);
    if (ids.has(id)) bad(`${at}: duplicate layer id ${id}.`);
    ids.add(id);

    const title = l.title ?? '';
    if (!isShortString(title)) bad(`${at}: title must be a string of at most 200 characters.`);

    const groups = l.groups ?? ['cathedral'];
    if (!Array.isArray(groups) || groups.length > 64 || !groups.every((g) => typeof g === 'string' && g.length >= 1 && g.length <= 64)) {
      bad(`${at}: groups must be an array of group ids.`);
    }

    const blend = l.blend ?? 'add';
    if (!BLENDS.includes(blend)) bad(`${at}: blend must be one of ${BLENDS.join(', ')}.`);

    const level = l.level ?? 1;
    if (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1) bad(`${at}: level must be a number from 0 to 1.`);

    const params = l.params ?? {};
    if (!isPlainObject(params)) bad(`${at}: params must be an object.`);
    const keys = Object.keys(params);
    if (keys.length > 64) bad(`${at}: too many params.`);
    for (const k of keys) {
      if (k.length > 64 || !cleanParamValue(params[k])) bad(`${at}: param ${k.slice(0, 64)} has an unsupported value.`);
    }

    // Keep small UI flags the client may add (e.g. enabled, solo); drop anything bulky.
    const extra = {};
    for (const [k, v] of Object.entries(l)) {
      if (LAYER_KEYS.has(k) || Object.keys(extra).length >= 16 || k.length > 64) continue;
      if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || isShortString(v)) extra[k] = v;
    }
    return { id, title, code: l.code, groups: [...groups], blend, level, params: { ...params }, ...extra };
  });
}

function cleanTitle(v, { required }) {
  if (v === undefined && !required) return undefined;
  if (typeof v !== 'string' || !v.trim()) bad('title is required.');
  const t = v.trim();
  if (t.length > 200) bad('title must be at most 200 characters.');
  return t;
}

function cleanSummary(v) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > 2000) bad('summary must be a string of at most 2000 characters.');
  return v.trim();
}

function cleanBool(v, name) {
  if (typeof v !== 'boolean') bad(`${name} must be true or false.`);
  return v;
}

const newestBy = (field) => (a, b) => {
  const x = a[field] ?? a.createdAt ?? '';
  const y = b[field] ?? b.createdAt ?? '';
  return x < y ? 1 : x > y ? -1 : 0;
};

// ---------------------------------------------------------------------------
// API

/**
 * createApi({ store, auth, queue, adapterName, loaders, log, trustProxy, maxIdeasPerDay })
 *   → async handleApi(req, res, pathname, searchParams)
 */
export function createApi({ store, auth, queue, adapterName = 'sketch', loaders, log = createLog(), trustProxy = false, maxIdeasPerDay = MAX_IDEAS_PER_DAY }) {
  const ownerName = (id) => store.users.get(id)?.username ?? '';

  function presentLook(look, { versions = false } = {}) {
    const { versions: list, ...rest } = look;
    const out = {
      ...rest,
      ownerName: ownerName(look.owner) || look.ownerName || '',
      summary: rest.summary ?? '',
      layers: rest.layers ?? [],
      shared: rest.shared === true,
      reviewed: rest.reviewed === true,
      versionCount: Array.isArray(list) ? list.length : 0,
    };
    if (versions) out.versions = Array.isArray(list) ? list : [];
    return out;
  }

  function visibleLook(id, user) {
    const look = store.looks.get(id);
    if (!look || (look.owner !== user.id && look.shared !== true)) throw new HttpError(404, 'Look not found.');
    return look;
  }

  function enqueue(idea) {
    const fail = (err) => {
      log.error?.(`generator: enqueue failed for idea ${idea.id}:`, err);
      const cur = store.ideas.get(idea.id);
      if (cur && (cur.status === 'queued' || cur.status === 'generating')) {
        store.ideas.update(idea.id, { status: 'failed', error: 'The idea could not be queued.' });
      }
    };
    try {
      const r = queue.enqueue(idea);
      if (r && typeof r.then === 'function') r.then(undefined, fail);
    } catch (err) {
      fail(err);
    }
  }

  const routes = [
    // --- accounts
    {
      method: 'POST', path: /^\/api\/signup$/, auth: false,
      async handler({ req, res, body }) {
        const user = await auth.signup(req, body);
        auth.logout(req);
        res.setHeader('Set-Cookie', auth.sessionCookie(auth.createSession(user)));
        return [201, { user: auth.publicUser(user) }];
      },
    },
    {
      method: 'POST', path: /^\/api\/login$/, auth: false,
      async handler({ req, res, body }) {
        const user = await auth.login(req, body);
        auth.logout(req);
        res.setHeader('Set-Cookie', auth.sessionCookie(auth.createSession(user)));
        return { user: auth.publicUser(user) };
      },
    },
    {
      method: 'POST', path: /^\/api\/logout$/, auth: false,
      handler({ req, res }) {
        auth.logout(req);
        res.setHeader('Set-Cookie', auth.clearCookie());
        return { ok: true };
      },
    },
    {
      method: 'GET', path: /^\/api\/me$/,
      handler: ({ user }) => ({ user: auth.publicUser(user) }),
    },

    // --- ideas
    {
      method: 'GET', path: /^\/api\/ideas$/,
      handler: ({ user }) => ({ ideas: store.ideas.list((i) => i.owner === user.id).reverse().sort(newestBy('createdAt')) }),
    },
    {
      method: 'POST', path: /^\/api\/ideas$/,
      handler({ user, body }) {
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (text.length < 3 || text.length > 2000) bad('Describe the idea in 3–2000 characters.');
        const since = Date.now() - DAY_MS;
        const today = store.ideas.list((i) => i.owner === user.id && Date.parse(i.createdAt) > since).length;
        if (today >= maxIdeasPerDay) throw new HttpError(429, `That's ${maxIdeasPerDay} ideas today. Try again tomorrow.`);
        const idea = store.ideas.create({ owner: user.id, text, status: 'queued', generator: adapterName });
        enqueue(idea);
        return [201, { idea: store.ideas.get(idea.id) ?? idea }];
      },
    },
    {
      method: 'GET', path: /^\/api\/ideas\/([A-Za-z0-9_-]{1,64})$/,
      handler({ user, params: [id] }) {
        const idea = store.ideas.get(id);
        if (!idea || idea.owner !== user.id) throw new HttpError(404, 'Idea not found.');
        return { idea };
      },
    },

    // --- looks
    {
      method: 'GET', path: /^\/api\/looks$/,
      handler({ user, query }) {
        const scope = query.get('scope') || 'mine';
        let looks;
        if (scope === 'mine') looks = store.looks.list((l) => l.owner === user.id).reverse().sort(newestBy('updatedAt'));
        else if (scope === 'gallery') looks = store.looks.list((l) => l.shared === true).reverse().sort(newestBy('sharedAt')).slice(0, GALLERY_LIMIT);
        else bad('scope must be mine or gallery.');
        return { looks: looks.map((l) => presentLook(l)) };
      },
    },
    {
      method: 'POST', path: /^\/api\/looks$/,
      handler({ user, body }) {
        const title = cleanTitle(body.title, { required: true });
        const summary = cleanSummary(body.summary);
        const layers = validateLayers(body.layers);
        const shared = body.shared === undefined ? false : cleanBool(body.shared, 'shared');
        let ideaId;
        if (body.ideaId !== undefined && body.ideaId !== null) {
          const idea = typeof body.ideaId === 'string' ? store.ideas.get(body.ideaId) : null;
          if (!idea || idea.owner !== user.id) bad('ideaId does not name one of your ideas.');
          ideaId = idea.id;
        }
        if (store.looks.list((l) => l.owner === user.id).length >= MAX_LOOKS_PER_USER) {
          throw new HttpError(429, `You have ${MAX_LOOKS_PER_USER} looks; delete some first.`);
        }
        const look = store.looks.create({
          owner: user.id,
          ownerName: user.username,
          title,
          summary,
          layers,
          shared,
          ...(shared ? { sharedAt: new Date().toISOString() } : {}),
          ...(ideaId ? { ideaId } : {}),
          reviewed: false,
          versions: [],
        });
        return [201, { look: presentLook(look) }];
      },
    },
    {
      method: 'GET', path: /^\/api\/looks\/([A-Za-z0-9_-]{1,64})$/,
      handler({ user, params: [id], query }) {
        const look = visibleLook(id, user);
        return { look: presentLook(look, { versions: query.get('versions') === '1' && look.owner === user.id }) };
      },
    },
    {
      method: 'PUT', path: /^\/api\/looks\/([A-Za-z0-9_-]{1,64})$/,
      handler({ user, params: [id], body, query }) {
        const look = visibleLook(id, user);
        const isOwner = look.owner === user.id;
        const isCurator = auth.isCurator(user);
        const patch = {};

        if (body.title !== undefined) patch.title = cleanTitle(body.title, { required: false });
        if (body.summary !== undefined) patch.summary = cleanSummary(body.summary);
        if (body.shared !== undefined) {
          patch.shared = cleanBool(body.shared, 'shared');
          if (patch.shared && look.shared !== true) patch.sharedAt = new Date().toISOString();
        }
        let layersChanged = false;
        if (body.layers !== undefined) {
          const layers = validateLayers(body.layers);
          if (JSON.stringify(layers) !== JSON.stringify(look.layers ?? [])) {
            layersChanged = true;
            patch.layers = layers;
            const prev = { title: look.title, summary: look.summary ?? '', layers: look.layers ?? [], savedAt: look.updatedAt };
            patch.versions = [...(Array.isArray(look.versions) ? look.versions : []), prev].slice(-MAX_VERSIONS);
          }
        }
        const changes = ['title', 'summary', 'shared'].filter((k) => k in patch && patch[k] !== (look[k] ?? (k === 'summary' ? '' : k === 'shared' ? false : undefined)));
        if (layersChanged) changes.push('layers');

        // Only the owner edits; a curator may also set `reviewed` on a look shared with them.
        if (!isOwner && (changes.length || !isCurator)) throw new HttpError(403, 'Only the owner can edit this look.');

        if (body.reviewed !== undefined) {
          const reviewed = cleanBool(body.reviewed, 'reviewed');
          if (reviewed !== (look.reviewed === true)) {
            if (!isCurator) throw new HttpError(403, 'Only curators can mark a look reviewed.');
            patch.reviewed = reviewed;
            patch.reviewedBy = reviewed ? user.username : undefined;
          }
        } else if (layersChanged && look.reviewed === true) {
          patch.reviewed = false; // new code needs a fresh review
          patch.reviewedBy = undefined;
        }

        const updated = Object.keys(patch).length ? store.looks.update(id, patch) : look;
        return { look: presentLook(updated, { versions: query.get('versions') === '1' && isOwner }) };
      },
    },
    {
      method: 'DELETE', path: /^\/api\/looks\/([A-Za-z0-9_-]{1,64})$/,
      handler({ user, params: [id] }) {
        const look = visibleLook(id, user);
        if (look.owner !== user.id) throw new HttpError(403, 'Only the owner can delete this look.');
        store.looks.remove(id);
        return { ok: true };
      },
    },

    // --- library
    {
      method: 'GET', path: /^\/api\/library$/, auth: false,
      handler: () => ({
        patterns: loaders.loadLibrary().map(({ name, title, summary, tags, code }) => ({ name, title, summary, tags, code })),
      }),
    },
  ];

  return async function handleApi(req, res, pathname, query = new URLSearchParams()) {
    try {
      const matching = routes.filter((r) => r.path.test(pathname));
      if (!matching.length) throw new HttpError(404, 'No such API route.');
      const route = matching.find((r) => r.method === req.method);
      if (!route) {
        throw new HttpError(405, 'Method not allowed.', { Allow: matching.map((r) => r.method).join(', ') });
      }
      const mutating = MUTATING.has(req.method);
      if (mutating) checkMutation(req, trustProxy);
      const session = auth.authenticate(req);
      if (route.auth !== false && !session) throw new HttpError(401, 'Log in first.');
      const body = mutating ? await readJson(req) : {};
      const ctx = { req, res, body, query, user: session?.user ?? null, params: pathname.match(route.path).slice(1) };
      const result = await route.handler(ctx);
      const [status, data] = Array.isArray(result) ? result : [200, result];
      sendJson(res, status, data);
    } catch (err) {
      if (res.headersSent) {
        res.destroy(err);
        return;
      }
      if (err instanceof HttpError) {
        for (const [k, v] of Object.entries(err.headers ?? {})) res.setHeader(k, v);
        sendJson(res, err.status, { error: err.message });
      } else {
        log.error?.(`${req.method} ${pathname}:`, err);
        sendJson(res, 500, { error: 'Internal server error.' });
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Generator queue

function fallbackQueue(store, reason) {
  return {
    adapterName: 'none',
    enqueue(idea) {
      store.ideas.update(idea.id, { status: 'failed', error: `No idea generator is available on this server (${reason}).` });
    },
    idle: async () => {},
  };
}

/** Imports src/generate/index.js and calls createQueue(); falls back to a queue that fails ideas. */
export async function loadGenerator({ moduleUrl = new URL('./generate/index.js', import.meta.url).href, store, loadLibrary, loadGroups, adapterName, log }) {
  let mod;
  try {
    mod = await import(moduleUrl);
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') log.warn?.(`generator: ${err.message.split('\n')[0]} — ideas will be marked failed.`);
    else log.error?.('generator: could not load src/generate/index.js:', err);
    return fallbackQueue(store, 'generator not installed');
  }
  if (typeof mod.createQueue !== 'function') {
    log.error?.('generator: src/generate/index.js does not export createQueue()');
    return fallbackQueue(store, 'generator not installed');
  }
  try {
    const queue = await mod.createQueue({ store, loadLibrary, loadGroups, adapterName, log });
    if (!queue || typeof queue.enqueue !== 'function') throw new Error('createQueue() did not return { enqueue }');
    return queue;
  } catch (err) {
    log.error?.('generator: createQueue() failed:', err);
    return fallbackQueue(store, 'generator failed to start');
  }
}

// ---------------------------------------------------------------------------
// Server

function splitUrl(raw = '/') {
  let target = raw;
  if (/^https?:\/\//i.test(target)) {
    try {
      const u = new URL(target);
      target = u.pathname + u.search;
    } catch {
      return null;
    }
  }
  if (!target.startsWith('/')) return null;
  const q = target.indexOf('?');
  return {
    pathname: q < 0 ? target : target.slice(0, q),
    query: new URLSearchParams(q < 0 ? '' : target.slice(q + 1)),
  };
}

/**
 * createServer({ dataDir, publicDir, generator?, generatorName?, curators?, secureCookies?,
 *                rateLimit?, trustProxy?, log?, maxIdeasPerDay?, generatorModule? })
 *   → Promise<{ server, store, auth, queue, loaders, adapterName, handler,
 *               listen(port = 0, host = '127.0.0.1') → Promise<address>, close() → Promise }>
 *
 * `generator` is a ready queue `{ enqueue(idea), idle?() }` (tests) or a createQueue-style
 * factory; when omitted, src/generate/index.js is imported (with a fallback if it is missing).
 */
export async function createServer(opts = {}) {
  const {
    dataDir = DEFAULT_DATA_DIR,
    publicDir = DEFAULT_PUBLIC_DIR,
    generator,
    generatorName = 'sketch',
    generatorModule,
    curators = [],
    secureCookies = false,
    rateLimit,
    trustProxy = false,
    maxIdeasPerDay = MAX_IDEAS_PER_DAY,
    log = createLog(),
  } = opts;

  const store = await createStore(dataDir, { log });
  const auth = createAuth({ store, curators, secureCookies, rateLimit, trustProxy });
  auth.pruneSessions();
  const loaders = createLoaders(publicDir, { log });
  const deps = { store, loadLibrary: loaders.loadLibrary, loadGroups: loaders.loadGroups, adapterName: generatorName, log };

  let queue;
  if (typeof generator === 'function') queue = await generator(deps);
  else if (generator) queue = generator;
  else queue = await loadGenerator({ ...deps, ...(generatorModule ? { moduleUrl: generatorModule } : {}) });
  const adapterName = typeof queue.adapterName === 'string' && queue.adapterName ? queue.adapterName : generatorName;

  const api = createApi({ store, auth, queue, adapterName, loaders, log, trustProxy, maxIdeasPerDay });
  const serveStatic = createStatic({ publicDir, log });

  async function handler(req, res) {
    applySecurityHeaders(res);
    const url = splitUrl(req.url);
    if (!url) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Bad request');
    }
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) await api(req, res, url.pathname, url.query);
      else await serveStatic(req, res, url.pathname);
    } catch (err) {
      log.error?.(`${req.method} ${url.pathname}:`, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal server error');
      } else res.destroy();
    }
  }

  const server = http.createServer(handler);
  server.requestTimeout = 60_000;
  server.headersTimeout = 30_000;
  const pruneTimer = setInterval(() => auth.pruneSessions(), 60 * 60 * 1000);
  pruneTimer.unref();

  return {
    server,
    store,
    auth,
    queue,
    loaders,
    adapterName,
    handler,
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
      if (typeof queue.idle === 'function') {
        let timer;
        await Promise.race([
          Promise.resolve(queue.idle()).catch(() => {}),
          new Promise((r) => {
            timer = setTimeout(r, 5000);
            timer.unref();
          }),
        ]);
        clearTimeout(timer);
      }
      await store.flush();
    },
  };
}
