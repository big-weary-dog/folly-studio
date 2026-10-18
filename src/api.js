// The HTTP API (SPEC "HTTP API"): accounts, ideas and the library here, looks in api-looks.js, baked frames in
// frames-http.js; and its plumbing: JSON bodies in and out, CSRF checks on every mutation, the logger.

import zlib from 'node:zlib';

import { HttpError } from './auth.js';
import { lookRoutes, newestBy } from './api-looks.js';
import { removeFrames } from './bake.js';
import { framesRoutes } from './frames-http.js';
import { etagMatches, etagOf, pickEncoding } from './static.js';

export const MAX_BODY = 256 * 1024;
const MIN_COMPRESS = 1024;
// Quality 5 is a millisecond for a large look and within 10 % of the best; JSON is made per request.
const Z = zlib.constants;
const ENCODE = {
  br: (b) => zlib.brotliCompressSync(b, { params: { [Z.BROTLI_PARAM_QUALITY]: 5,
    [Z.BROTLI_PARAM_MODE]: Z.BROTLI_MODE_TEXT, [Z.BROTLI_PARAM_SIZE_HINT]: b.length } }),
  gzip: (b) => zlib.gzipSync(b, { level: 6 }),
};
export const STREAMED = Symbol('streamed'); // a handler that wrote the response itself

/** A logger usable both as log(...) and log.info/warn/error(...). */
export function createLog(prefix = '[studio]') {
  // oxlint-disable-next-line no-console -- the logger: the one place server output is written
  const log = (...a) => console.info(prefix, ...a);
  return Object.assign(log, { info: log, debug: () => {}, warn: (...a) => console.warn(prefix, ...a),
    error: (...a) => console.error(prefix, ...a) });
}

/**
 * JSON out, br or gzip when it is worth it. A GET's 200 is revalidated each time (ETag, 304): a reload or a
 * poll moves no body when nothing changed.
 */
export function sendJson(req, res, status, data) {
  let body = Buffer.from(JSON.stringify(data));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const enc = body.length >= MIN_COMPRESS ? pickEncoding(req.headers['accept-encoding']) : null;
  if (enc) headers.Vary = 'Accept-Encoding';
  if (req.method === 'GET' && status === 200) {
    Object.assign(headers, { 'Cache-Control': 'private, no-cache', ETag: etagOf(body) });
    if (etagMatches(req.headers['if-none-match'], headers.ETag)) { res.writeHead(304, headers); return res.end(); }
  }
  if (enc) { body = ENCODE[enc](body); headers['Content-Encoding'] = enc; }
  res.writeHead(status, { ...headers, 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const stripDefaultPort = (host) => host.toLowerCase().replace(/:(80|443)$/, '');

/** CSRF: JSON content type, and a same-origin Origin when one is sent. */
export function checkMutation(req, trustProxy) {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originHost = null;
    try { originHost = new URL(origin).host; } catch { /* "null" or garbage */ }
    const fwd = trustProxy && typeof req.headers['x-forwarded-host'] === 'string'
      ? req.headers['x-forwarded-host'].split(',')[0].trim() : '';
    const host = fwd || req.headers.host || '';
    if (!originHost || !host || stripDefaultPort(originHost) !== stripDefaultPort(host)) {
      throw new HttpError(403, 'Cross-origin request refused.');
    }
  }
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json.');
}

/** The request body as a JSON object ({} when empty); 413 past `max` bytes, 400 when not an object. */
export function readJson(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const tooBig = () => new HttpError(413, `Request body is over ${Math.round(max / 1024)} kB.`);
    if (Number(req.headers['content-length']) > max) {
      req.resume(); // discard; node keeps the connection usable
      return reject(tooBig());
    }
    const chunks = [];
    let size = 0, done = false;
    const finish = (fn, v) => { if (!done) { done = true; fn(v); } };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) finish(reject, tooBig());
      else if (!done) chunks.push(chunk);
    });
    req.on('error', (err) => finish(reject, err));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return finish(resolve, {});
      let value;
      try { value = JSON.parse(text); } catch { return finish(reject, new HttpError(400, 'Body is not valid JSON.')); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return finish(reject, new HttpError(400, 'Body must be a JSON object.'));
      }
      finish(resolve, value);
    });
  });
}

/** A request target as { pathname, query }, or null when it is not one. */
export function splitUrl(raw = '/') {
  let target = raw;
  if (/^https?:\/\//i.test(target)) {
    try { const u = new URL(target); target = u.pathname + u.search; } catch { return null; }
  }
  if (!target.startsWith('/')) return null;
  const q = target.indexOf('?');
  return { pathname: q < 0 ? target : target.slice(0, q),
    query: new URLSearchParams(q < 0 ? '' : target.slice(q + 1)) };
}

export { HttpError } from './auth.js';
export { validateLayers } from './look-rules.js';

export const MAX_IDEAS_PER_DAY = 20;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Hand an idea to the generator queue; if that fails, mark the idea failed. */
export function enqueueIdea({ queue, store, log }, idea) {
  const fail = (err) => {
    log.error?.(`generator: enqueue failed for idea ${idea.id}:`, err);
    const cur = store.ideas.get(idea.id);
    if (cur && (cur.status === 'queued' || cur.status === 'generating')) {
      store.ideas.update(idea.id, { status: 'failed', error: 'The idea could not be queued.' });
    }
  };
  try { Promise.resolve(queue.enqueue(idea)).catch(fail); } catch (err) { fail(err); }
}

// createApi({ store, auth, queue, adapterName, loaders, log, trustProxy, maxIdeasPerDay, framesDir, bakes,
//   frames (src/frames-cache.js) }) → async handleApi(req, res, pathname, searchParams)
export function createApi(o) {
  const { store, auth, queue, adapterName = 'sketch', loaders, log = createLog(), trustProxy = false } = o;
  const { maxIdeasPerDay = MAX_IDEAS_PER_DAY, bakes, framesDir, frames } = o;
  const dropFrames = (id) => removeFrames(framesDir, id).then(() => frames.prune());
  const looks = lookRoutes({ store, auth, bakes, dropFrames });
  // Sign up or log in: a fresh session replaces any old one.
  const signIn = (how, status) => async ({ req, res, body }) => {
    const user = await auth[how](req, body);
    auth.logout(req);
    res.setHeader('Set-Cookie', auth.sessionCookie(auth.createSession(user)));
    return [status, { user: auth.publicUser(user) }];
  };

  const routes = [
    { method: 'POST', path: /^\/api\/signup$/, auth: false, handler: signIn('signup', 201) },
    { method: 'POST', path: /^\/api\/login$/, auth: false, handler: signIn('login', 200) },
    { method: 'POST', path: /^\/api\/logout$/, auth: false,
      handler({ req, res }) {
        auth.logout(req);
        res.setHeader('Set-Cookie', auth.clearCookie());
        return { ok: true };
      } },
    { method: 'GET', path: /^\/api\/me$/, handler: ({ user }) => ({ user: auth.publicUser(user) }) },

    { method: 'GET', path: /^\/api\/ideas$/, handler: ({ user }) => ({
      ideas: store.ideas.list((i) => i.owner === user.id).reverse().sort(newestBy('createdAt')) }) },
    { method: 'POST', path: /^\/api\/ideas$/,
      handler({ user, body }) {
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (text.length < 3 || text.length > 2000) throw new HttpError(400, 'Describe the idea in 3–2000 characters.');
        const since = Date.now() - DAY_MS;
        const today = store.ideas.list((i) => i.owner === user.id && Date.parse(i.createdAt) > since).length;
        if (today >= maxIdeasPerDay) {
          throw new HttpError(429, `That's ${maxIdeasPerDay} ideas today. Try again tomorrow.`);
        }
        const idea = store.ideas.create({ owner: user.id, text, status: 'queued', generator: adapterName });
        enqueueIdea({ queue, store, log }, idea);
        return [201, { idea: store.ideas.get(idea.id) ?? idea }];
      } },
    { method: 'GET', path: /^\/api\/ideas\/([A-Za-z0-9_-]{1,64})$/,
      handler({ user, params: [id] }) {
        const idea = store.ideas.get(id);
        if (!idea || idea.owner !== user.id) throw new HttpError(404, 'Idea not found.');
        return { idea };
      } },

    ...looks.routes,
    ...framesRoutes({ framesDir, cache: frames, visibleLook: looks.visibleLook, STREAMED }),

    { method: 'GET', path: /^\/api\/library$/, auth: false, handler: () => ({ patterns: loaders.loadLibrary()
      .map(({ name, title, summary, tags, kind = 'source', category = '', code }) => (
        { name, title, summary, tags, kind, category, code })) }) },
  ];

  return async function handleApi(req, res, pathname, query = new URLSearchParams()) {
    try {
      const matching = routes.filter((r) => r.path.test(pathname));
      if (!matching.length) throw new HttpError(404, 'No such API route.');
      const route = matching.find((r) => r.method === req.method);
      if (!route) throw new HttpError(405, 'Method not allowed.', { Allow: matching.map((r) => r.method).join(', ') });
      const mutating = MUTATING.has(req.method);
      if (mutating) checkMutation(req, trustProxy);
      const session = auth.authenticate(req);
      if (route.auth !== false && !session) throw new HttpError(401, 'Log in first.');
      const body = mutating ? await readJson(req) : {};
      const ctx = { req, res, body, query, user: session?.user ?? null, params: pathname.match(route.path).slice(1) };
      const result = await route.handler(ctx);
      if (result === STREAMED) return;
      const [status, data] = Array.isArray(result) ? result : [200, result];
      sendJson(req, res, status, data);
    } catch (err) {
      if (res.headersSent) return res.destroy(err);
      if (!(err instanceof HttpError)) {
        log.error?.(`${req.method} ${pathname}:`, err);
        return sendJson(req, res, 500, { error: 'Internal server error.' });
      }
      for (const [k, v] of Object.entries(err.headers ?? {})) res.setHeader(k, v);
      sendJson(req, res, err.status, { error: err.message });
    }
  };
}
