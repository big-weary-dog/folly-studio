// The HTTP API under /api (SPEC "HTTP API"): accounts, ideas and the library here, looks in api-looks.ts, models in
// api-models.ts, baked frames in frames-http.ts, plumbing in http.ts. Each mutation passes the CSRF check first; then
// every route but the public ones needs a session. Logins are limited per IP, and failed ones per IP and username.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { type FlashSettings, type Idea, IdeaBody, Login, RefineBody, Signup } from '../shared/schemas/api.ts';
import type { AccessControl } from './access.ts';
import { accessRoutes, sendRefusal } from './api-access.ts';
import { lookRoutes } from './api-looks.ts';
import { modelRoutes } from './api-models.ts';
import { type Auth, COOKIE_NAME, SESSION_TTL_MS } from './auth.ts';
import type { Queue } from './app.ts';
import { type createBakeQueue, removeFrames } from './bake.ts';
import type { createFramesCache } from './frames-cache.ts';
import { framesRoutes } from './frames-http.ts';
import type { Registry } from './generate/models.ts';
import type { Hub } from './live/hub.ts';
import { liveRoutes } from './live/routes.ts';
import { checkMutation, HttpError, type Log, type Logger, parse, routes, sendJson } from './http.ts';
import type { LiveSettings } from '../shared/schemas/live.ts';
import type { createLoaders } from './static.ts';
import type { Store } from './store.ts';

/** How long GET /api/ideas/:id?wait= holds an unchanged idea, and how many such waits one user may have open. */
export const WAIT_MS = 25_000;
const WAITS_PER_USER = 6;

type Stored = NonNullable<ReturnType<Auth['authenticate']>>['user'];
declare module 'fastify' {
  interface FastifyRequest { user: Stored | null }
  interface FastifyContextConfig { public?: boolean }
}

/** Hand an idea to the generator queue; if that fails, mark the idea failed. */
export function enqueueIdea({ queue, store, log }: { queue: Queue, store: Pick<Store, 'ideas'>, log: Logger },
  idea: Idea) {
  const fail = (err: unknown) => {
    log.error?.(`generator: enqueue failed for idea ${idea.id}:`, err);
    const cur = store.ideas.get(idea.id);
    if (cur && (cur.status === 'queued' || cur.status === 'generating')) {
      store.ideas.update(idea.id, { status: 'failed', error: 'The idea could not be queued.' });
    }
  };
  try { Promise.resolve(queue.enqueue(idea)).catch(fail); } catch (err) { fail(err); }
}

export const newestBy = (field: string) => (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const x = String(a[field] ?? a.createdAt ?? ''), y = String(b[field] ?? b.createdAt ?? '');
  return x < y ? 1 : x > y ? -1 : 0;
};

/** The /api plugin. */
export function apiRoutes(o: { store: Store, auth: Auth, queue: Queue, models: Registry, log: Log,
  loaders: ReturnType<typeof createLoaders>, access: AccessControl, framesDir: string,
  bakes: ReturnType<typeof createBakeQueue>, frames: ReturnType<typeof createFramesCache>, secureCookies?: boolean,
  rateLimit?: { max?: number, ipMax?: number, windowMs?: number }, flash: FlashSettings, hub: Hub,
  live: LiveSettings }) {
  const { store, auth, queue, models, loaders, log, access } = o;
  const { bakes, framesDir, frames, secureCookies = false, flash } = o;
  const limits = { max: 10, ipMax: 100, windowMs: 60_000, ...o.rateLimit };
  return async (api: FastifyInstance) => {
    api.addHook('onRequest', checkMutation);
    api.addHook('onRequest', async (req) => {
      req.user = auth.authenticate(req.cookies[COOKIE_NAME])?.user ?? null;
      if (!req.routeOptions.config.public && !req.user) throw new HttpError(401, 'Log in first.');
    });
    api.addHook('onSend', sendJson);

    const nameOf = (req: FastifyRequest) => {
      const name = (req.body as { username?: unknown } | undefined)?.username;
      return typeof name === 'string' ? name.trim().toLowerCase().slice(0, 64) : '';
    };
    const window = { timeWindow: limits.windowMs };
    const perIp = api.createRateLimit({ ...window, max: limits.ipMax, keyGenerator: (req) => req.ip });
    const perName = api.createRateLimit({ ...window, max: limits.max,
      keyGenerator: (req) => `${req.ip}|${nameOf(req)}` });
    /** Sign up or log in: a fresh session replaces any old one. */
    const signIn = (status: number, run: (req: FastifyRequest) => Promise<Stored>) => async (req: FastifyRequest,
      reply: FastifyReply) => {
      const [ip, name] = [await perIp(req), await perName(req, { increment: false })];
      const wait = !ip.isAllowed && ip.isExceeded ? ip.ttlInSeconds
        : !name.isAllowed && name.remaining === 0 ? name.ttlInSeconds : 0;
      if (wait) throw new HttpError(429, 'Too many attempts. Try again in a minute.', { 'Retry-After': `${wait}` });
      const user = await run(req).catch(async (err) => { await perName(req); throw err; });
      auth.logout(req.cookies[COOKIE_NAME]);
      reply.setCookie(COOKIE_NAME, auth.createSession(user), cookie(SESSION_TTL_MS / 1000)).code(status);
      return { user: auth.publicUser(user), flash };
    };
    const cookie = (maxAge: number) => ({ httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge,
      secure: secureCookies });
    const dropFrames = (id: string) => removeFrames(framesDir, id).then(() => frames.prune());
    const looks = lookRoutes({ store, auth, bakes, dropFrames, log });
    const own = (req: FastifyRequest) => {
      const idea = store.ideas.get((req.params as { id: string }).id);
      if (!idea || idea.owner !== req.user!.id) throw new HttpError(404, 'Idea not found.');
      return idea;
    };
    // Long polls: an idea still as the client last saw it is answered when it changes, or after WAIT_MS.
    const waits = new Map<string, number>(), wakes = new Set<() => void>();
    api.addHook('preClose', async () => wakes.forEach((wake) => wake()));
    const changed = (req: FastifyRequest, reply: FastifyReply, idea: Idea) => new Promise<void>((resolve) => {
      const who = req.user!.id;
      let done = false;
      waits.set(who, (waits.get(who) ?? 0) + 1);
      const wake = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unwatch?.();
        wakes.delete(wake);
        reply.raw.off('close', wake);
        waits.set(who, waits.get(who)! - 1);
        if (!waits.get(who)) waits.delete(who);
        resolve();
      };
      const timer = setTimeout(wake, WAIT_MS);
      const unwatch = queue.watch?.(idea.id, wake);
      wakes.add(wake);
      reply.raw.once('close', wake); // the client went away
    });

    await api.register(liveRoutes({ store, auth, hub: o.hub, settings: o.live, listed: looks.listed }));
    routes(api, {
      'POST /signup': [signIn(201, (req) => auth.signup(parse(Signup, req.body))), { public: true }],
      'POST /login': [signIn(200, (req) => auth.login(Login.parse(req.body))), { public: true }],
      'POST /logout': [async (req, reply) => {
        auth.logout(req.cookies[COOKIE_NAME]);
        reply.setCookie(COOKIE_NAME, '', cookie(0));
        return { ok: true };
      }, { public: true }],
      'GET /me': async (req) => ({ user: auth.publicUser(req.user), flash, access: access.state(req.user!) }),

      'GET /ideas': async (req) => ({ ideas: store.ideas.list((i) => i.owner === req.user!.id).reverse()
        .sort(newestBy('createdAt')) }),
      'POST /ideas': async (req, reply) => {
        const { text, model } = parse(IdeaBody, req.body);
        const picked = models.pick(model, auth.roleOf(req.user), { paid: access.state(req.user!).unlocked });
        if ('error' in picked) throw new HttpError(400, picked.error);
        const refused = access.check(req.user!, picked.entry); // no await from here to the create: one step
        if (refused) return sendRefusal(reply, refused);
        const { id: chosen, label } = picked.entry;
        const idea = store.ideas.create({ owner: req.user!.id, text, status: 'queued', model: chosen, generator: chosen,
          by: label });
        enqueueIdea({ queue, store, log }, idea);
        reply.code(201);
        return { idea: store.ideas.get(idea.id) ?? idea };
      },
      // A refinement of one's own look (SPEC-generators "Refine"): an idea of its own, one use, by the model asked
      // for, else the one that made the look; one at a time per look.
      'POST /looks/:id/refine': async (req, reply) => {
        const look = store.looks.get((req.params as { id: string }).id);
        if (!look || look.owner !== req.user!.id) throw new HttpError(404, 'Look not found.');
        const { text, model, critique, fix } = parse(RefineBody, req.body);
        const made = model ?? (look.ideaId ? store.ideas.get(look.ideaId)?.model : undefined);
        const picked = models.pick(made, auth.roleOf(req.user), { paid: access.state(req.user!).unlocked });
        if ('error' in picked) throw new HttpError(400, picked.error);
        if (!['claude', 'codex', 'sketch'].includes(picked.entry.via)) {
          throw new HttpError(400, `${picked.entry.label} cannot refine a look; pick another model.`);
        }
        if (critique && !['claude', 'codex'].includes(picked.entry.via)) {
          throw new HttpError(400, `${picked.entry.label} cannot look at its frames; pick another model.`);
        }
        if (store.ideas.list((i) => i.lookId === look.id && !!i.refine
          && (i.status === 'queued' || i.status === 'generating')).length) {
          throw new HttpError(409, 'This look is already being refined.');
        }
        const refused = access.check(req.user!, picked.entry); // no await from here to the create: one step
        if (refused) return sendRefusal(reply, refused);
        const { id: chosen, label } = picked.entry;
        const ask = { ...(critique ? { critique: true as const } : {}), ...(fix ? { fix } : {}) };
        const idea = store.ideas.create({ owner: req.user!.id, text, status: 'queued', model: chosen, generator: chosen,
          by: label, lookId: look.id, refine: ask });
        enqueueIdea({ queue, store, log }, idea);
        reply.code(201);
        return { idea: store.ideas.get(idea.id) ?? idea };
      },
      'GET /ideas/:id': async (req, reply) => {
        const idea = own(req), seen = (req.query as { wait?: unknown }).wait;
        const pending = idea.status === 'queued' || idea.status === 'generating';
        if (!pending || seen !== `${idea.status}@${idea.updatedAt}` || !queue.watch
          || (waits.get(req.user!.id) ?? 0) >= WAITS_PER_USER) return { idea };
        await changed(req, reply, idea);
        return { idea: own(req) };
      },
      // An undone refinement (SPEC-generators "Refine history"): the Studio put its look back; history skips it.
      'POST /ideas/:id/undo': async (req) => {
        const idea = own(req);
        if (!idea.refine || idea.status !== 'ready') throw new HttpError(409, 'Only a finished refinement is undone.');
        return { idea: await store.ideas.update(idea.id, { undone: true }) };
      },
      ...modelRoutes({ auth, models, access }),
      ...accessRoutes(api, { auth, access, store }),
      ...looks.routes,
      ...framesRoutes({ framesDir, cache: frames, visibleLook: looks.visibleLook }),
      'GET /library': [async () => ({ patterns: loaders.loadLibrary()
        .map(({ name, title, summary, tags, kind, category, code, ...rest }) => ({ name, title, summary, tags, kind,
          category, code, ...(kind === 'preset' ? { layers: rest.layers, globals: rest.globals } : {}) })) }),
      { public: true }],
    });
  };
}
