// The HTTP API under /api (SPEC "HTTP API"): accounts, ideas and the library here, looks in api-looks.ts, models in
// api-models.ts, baked frames in frames-http.ts, plumbing in http.ts. Each mutation passes the CSRF check first; then
// every route but the public ones needs a session. Logins are limited per IP, and failed ones per IP and username.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { isPending, transition } from '../shared/idea-status.ts';
import { DEEP, type FlashSettings, type Idea, IdeaBody, Login, RefineBody, Signup } from '../shared/schemas/api.ts';
import type { AccessControl } from './access.ts';
import { accessRoutes, sendRefusal } from './api-access.ts';
import { ideaHowRoutes } from './api-idea-how.ts';
import { ideaLogRoutes } from './api-idea-log.ts';
import { lightRoutes } from './api-light.ts';
import { bakingRoutes } from './baking.ts';
import { lightsRoutes } from './lights.ts';
import { reportRoutes } from './api-reports.ts';
import { tourRoutes } from './api-tour.ts';
import { lookRoutes } from './api-looks.ts';
import { modelRoutes } from './api-models.ts';
import { type Auth, COOKIE_NAME, SESSION_TTL_MS, sessionHook } from './auth.ts';
import type { Queue } from './app.ts';
import { type createBakeQueue, removeFrames } from './bake.ts';
import type { createFramesCache } from './frames-cache.ts';
import { framesRoutes } from './frames-http.ts';
import { type IdeaLogs, ownerOutcome } from './generate/idea-log.ts';
import type { Registry } from './generate/models.ts';
import type { LightStore } from './light.ts';
import type { Reports } from './reports/store.ts';
import type { Hub } from './live/hub.ts';
import type { createPreviews } from './previews/index.ts';
import { liveRoutes } from './live/routes.ts';
import { adminsDeclared, checkMutation, HttpError, type Log, type Logger, parse, routes, sendJson } from './http.ts';
import type { LiveSettings } from '../shared/schemas/live.ts';
import { cannot, TRANSPORT_CAPS } from '../shared/schemas/models.ts';
import type { createLoaders } from './static.ts';
import { generates, type Profile } from './profile.ts';
import type { Store } from './store.ts';

/** How long GET /api/ideas/:id?wait= holds an unchanged idea, and how many such waits one user may have open. */
export const WAIT_MS = 25_000;
const WAITS_PER_USER = 6;

type Stored = NonNullable<ReturnType<Auth['authenticate']>>['user'];


/** An idea as its owner gets it: a failed round's error (an older idea may still hold one) left to the admin's log;
 * how it was made, from its own route. */
const forOwner = ({ how: _how, ...idea }: Idea): Idea => ({ ...idea,
  ...(idea.rounds ? { rounds: idea.rounds.map((r) => (r.outcome ? { ...r, outcome: ownerOutcome(r.outcome) } : r)) }
    : {}),
  ...(idea.verdict ? { verdict: ownerOutcome(idea.verdict) } : {}) });

/** Hand an idea to the generator queue; if that fails, mark the idea failed. */
export function enqueueIdea({ queue, store, log }: { queue: Queue, store: Pick<Store, 'ideas'>, log: Logger },
  idea: Idea) {
  const fail = (err: unknown) => {
    log.error?.(`generator: enqueue failed for idea ${idea.id}:`, err);
    const cur = store.ideas.get(idea.id);
    if (cur && isPending(cur)) {
      store.ideas.update(idea.id, transition(cur, 'failed', { error: 'The idea could not be queued.' }));
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
  live: LiveSettings, ideaLogs: IdeaLogs, previews?: ReturnType<typeof createPreviews>, reports: Reports,
  build: string, tail: () => unknown[], light: LightStore, profile?: Profile,
  baking?: Parameters<typeof bakingRoutes>[0], stats?: Parameters<typeof routes>[1],
  lights?: Pick<Parameters<typeof lightsRoutes>[0], 'store' | 'feed' | 'hub' | 'drive'> }) {
  const { store, auth, queue, models, loaders, log, access } = o;
  const { bakes, framesDir, frames, secureCookies = false, flash } = o;
  const limits = { max: 10, ipMax: 100, windowMs: 60_000, ...o.rateLimit };
  const profile = o.profile ?? 'hosted', gen = generates(profile);
  return async (api: FastifyInstance) => {
    api.addHook('onRequest', checkMutation);
    api.addHook('onRoute', adminsDeclared);
    api.addHook('onRequest', sessionHook(auth));
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
      return { user: auth.publicUser(user), flash, profile };
    };
    const cookie = (maxAge: number) => ({ httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge,
      secure: secureCookies });
    const dropFrames = (id: string) => removeFrames(framesDir, id).then(() => frames.prune());
    const looks = lookRoutes({ store, auth, bakes, dropFrames, previews: o.previews, loadLibrary: loaders.loadLibrary,
      log });
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

    // Ideas, refinements and their undo (SPEC-generators); none on the Pi (SPEC-offline).
    const ideaRoutes: Parameters<typeof routes>[1] = {
      'GET /ideas': async (req) => ({ ideas: store.ideas.list((i) => i.owner === req.user!.id).reverse()
        .sort(newestBy('createdAt')).map(forOwner) }),
      'POST /ideas': async (req, reply) => {
        const { text, model, explore: asked } = parse(IdeaBody, req.body);
        const picked = models.pick(model, auth.roleOf(req.user), { paid: access.state(req.user!).unlocked });
        if ('error' in picked) throw new HttpError(400, picked.error);
        // Only the prompted models explore (SPEC-generators "Explore"); the others' ideas say nothing of it.
        const explore = TRANSPORT_CAPS[picked.entry.via].explores ? asked : undefined;
        if (explore === 'deep' && !DEEP.enabled) throw new HttpError(400, 'Deep is off for now; try Explore.');
        if (explore === 'deep' && DEEP.adminOnly && !auth.can(req.user, 'admin')) {
          throw new HttpError(403, 'Deep is for admins for now; try Explore.');
        }
        const refused = access.check(req.user!, picked.entry, Date.now(), explore); // no await to the create
        if (refused) return sendRefusal(reply, refused);
        const { id: chosen, label } = picked.entry;
        const idea = store.ideas.create({ owner: req.user!.id, text, status: 'queued', model: chosen, generator: chosen,
          by: label, ...(explore ? { explore } : {}) });
        enqueueIdea({ queue, store, log }, idea);
        reply.code(201);
        return { idea: store.ideas.get(idea.id) ?? idea };
      },
      // A refinement of one's own look (SPEC-generators "Refine"): an idea of its own, one use, by the model asked
      // for, else the one that made the look; one at a time per look.
      'POST /looks/:id/refine': async (req, reply) => {
        const look = store.looks.get((req.params as { id: string }).id);
        if (!look || !auth.can(req.user, 'edit', look)) throw new HttpError(404, 'Look not found.');
        const { text, model, critique, fix } = parse(RefineBody, req.body);
        const made = model ?? (look.ideaId ? store.ideas.get(look.ideaId)?.model : undefined);
        const picked = models.pick(made, auth.roleOf(req.user), { paid: access.state(req.user!).unlocked });
        if ('error' in picked) throw new HttpError(400, picked.error);
        const unable = cannot(picked.entry, { refine: true, critique });
        if (unable) throw new HttpError(400, `${unable}; pick another model.`);
        if (store.ideas.list((i) => i.lookId === look.id && !!i.refine && isPending(i)).length) {
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
        if (!isPending(idea) || seen !== `${idea.status}@${idea.updatedAt}` || !queue.watch
          || (waits.get(req.user!.id) ?? 0) >= WAITS_PER_USER) return { idea: forOwner(idea) };
        await changed(req, reply, idea);
        return { idea: forOwner(own(req)) };
      },
      // An undone refinement (SPEC-generators "Refine history"): the Studio put its look back; history skips it.
      'POST /ideas/:id/undo': async (req) => {
        const idea = own(req);
        if (!idea.refine || idea.status !== 'ready') throw new HttpError(409, 'Only a finished refinement is undone.');
        return { idea: forOwner(store.ideas.update(idea.id, { undone: true })!) };
      },
    };
    const reports = reportRoutes(api, { reports: o.reports, build: o.build, tail: o.tail });
    await api.register(liveRoutes({ store, auth, hub: o.hub, settings: o.live, listed: looks.listed }));
    routes(api, {
      'POST /signup': [signIn(201, (req) => auth.signup(parse(Signup, req.body))), { public: true }],
      'POST /login': [signIn(200, (req) => auth.login(Login.parse(req.body))), { public: true }],
      'POST /logout': [async (req, reply) => {
        auth.logout(req.cookies[COOKIE_NAME]);
        reply.setCookie(COOKIE_NAME, '', cookie(0));
        return { ok: true };
      }, { public: true }],
      ...tourRoutes({ store }),
      'GET /me': async (req) => ({ user: auth.publicUser(req.user), flash,
        ...(gen ? { access: access.state(req.user!) } : {}), profile }),
      ...(gen ? { ...ideaRoutes, ...modelRoutes({ auth, models, access }), ...ideaLogRoutes({ logs: o.ideaLogs }),
        ...ideaHowRoutes({ store, auth, logs: o.ideaLogs, forOwner }),
        ...accessRoutes(api, { access, store }) } : {}),
      ...lightRoutes({ light: o.light }),
      ...(o.baking ? bakingRoutes(o.baking) : {}),
      ...o.stats,
      ...(o.lights ? lightsRoutes({ ...o.lights, loadLibrary: loaders.loadLibrary, visibleLook: looks.visibleLook,
        looksIn: looks.looksIn, listed: looks.listed })
        : {}),
      ...reports,
      ...looks.routes,
      ...framesRoutes({ framesDir, cache: frames, visibleLook: looks.visibleLook }),
      'GET /library': [async () => ({ patterns: loaders.loadLibrary()
        .map(({ name, title, summary, tags, kind, category, code, ...rest }) => ({ name, title, summary, tags, kind,
          category, code, ...(kind === 'preset' ? { layers: rest.layers, globals: rest.globals } : {}) })) }),
      { public: true }],
    });
  };
}
