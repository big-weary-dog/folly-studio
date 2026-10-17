// The HTTP API (SPEC "HTTP API"): accounts, ideas and the library here, looks in api-looks.js,
// baked frames in frames-http.js. JSON in and out; mutations pass the CSRF checks in http.js.

import { HttpError } from './auth.js';
import { lookRoutes, newestBy } from './api-looks.js';
import { removeFrames } from './bake.js';
import { framesRoutes } from './frames-http.js';
import { checkMutation, createLog, readJson, sendJson, STREAMED } from './http.js';

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
        if (text.length < 3 || text.length > 2000) {
          throw new HttpError(400, 'Describe the idea in 3–2000 characters.');
        }
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
