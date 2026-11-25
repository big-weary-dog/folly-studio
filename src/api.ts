// The HTTP API under /api (SPEC "HTTP API"): accounts and the library here, looks in api-looks.ts, baked frames in
// frames-http.ts, plumbing in http.ts. Each mutation passes the CSRF check first; then every route but the public
// ones needs a session. Logins are limited per IP, and failed ones per IP and username.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { type FlashSettings, GuestBody, Login, Signup } from '../shared/schemas/api.ts';
import { perAccount } from './account-limit.ts';
import { accountRoutes } from './api-account.ts';
import { peopleRoutes } from './api-people.ts';
import { lightRoutes } from './api-light.ts';
import { bakingRoutes } from './baking.ts';
import { reportRoutes } from './api-reports.ts';
import { tourRoutes } from './api-tour.ts';
import { lookRoutes } from './api-looks.ts';
import { type Auth, COOKIE_NAME, GUEST_TTL_MS, SESSION_TTL_MS, sessionHook } from './auth.ts';
import { type createBakeQueue, removeFrames } from './bake.ts';
import type { createFramesCache } from './frames-cache.ts';
import { framesRoutes } from './frames-http.ts';
import type { LightStore } from './light.ts';
import type { Reports } from './reports/store.ts';
import type { createPreviews } from './previews/index.ts';
import { adminsDeclared, checkMutation, HttpError, type Log, parse, routes, sendJson } from './http.ts';
import type { RigName } from '../shared/schemas/rig.ts';
import type { createLoaders } from './static.ts';
import type { Store } from './store.ts';

type Stored = NonNullable<ReturnType<Auth['authenticate']>>['user'];

export const newestBy = (field: string) => (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const x = String(a[field] ?? a.createdAt ?? ''), y = String(b[field] ?? b.createdAt ?? '');
  return x < y ? 1 : x > y ? -1 : 0;
};

/** The /api plugin. */
export function apiRoutes(o: { store: Store, auth: Auth, log: Log,
  loaders: ReturnType<typeof createLoaders>, framesDir: string,
  bakes: ReturnType<typeof createBakeQueue>, frames: ReturnType<typeof createFramesCache>, secureCookies?: boolean,
  rateLimit?: { max?: number, ipMax?: number, guestMax?: number, windowMs?: number, writeMax?: number },
  flash: FlashSettings, previews?: ReturnType<typeof createPreviews>, reports: Reports,
  build: string, tail: () => unknown[], light: LightStore, rig?: RigName,
  baking?: Parameters<typeof bakingRoutes>[0], stats?: Parameters<typeof routes>[1],
  codeGate?: Parameters<typeof lookRoutes>[0]['codeGate'] }) {
  const { store, auth, loaders, log } = o;
  const { bakes, framesDir, frames, secureCookies = false, flash } = o;
  const limits = { max: 10, ipMax: 100, guestMax: 10, windowMs: 60_000, writeMax: 120, ...o.rateLimit };
  const rig = o.rig ?? 'folly';
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
    const perGuest = api.createRateLimit({ ...window, max: limits.guestMax, keyGenerator: (req) => `guest|${req.ip}` });
    /** Sign up or log in: a fresh session replaces any old one. */
    const signIn = (status: number, run: (req: FastifyRequest) => Promise<Stored>) => async (req: FastifyRequest,
      reply: FastifyReply) => {
      const [ip, name] = [await perIp(req), await perName(req, { increment: false })];
      const wait = !ip.isAllowed && ip.isExceeded ? ip.ttlInSeconds
        : !name.isAllowed && name.remaining === 0 ? name.ttlInSeconds : 0;
      if (wait) throw new HttpError(429, 'Too many attempts. Try again in a minute.', { 'Retry-After': `${wait}` });
      const user = await run(req).catch(async (err) => { await perName(req); throw err; });
      return start(user, status, req, reply);
    };
    const start = (user: Stored, status: number, req: FastifyRequest, reply: FastifyReply) => {
      auth.logout(req.cookies[COOKIE_NAME]);
      reply.setCookie(COOKIE_NAME, auth.createSession(user),
        cookie((user.guest ? GUEST_TTL_MS : SESSION_TTL_MS) / 1000)).code(status);
      return { user: auth.publicUser(user), flash, rig };
    };
    const cookie = (maxAge: number) => ({ httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge,
      secure: secureCookies });
    const dropFrames = (id: string) => removeFrames(framesDir, id).then(() => frames.prune());
    const removal = { store, auth, dropFrames, previews: o.previews, log };
    const limitWrites = perAccount(api, { name: 'look', windowMs: limits.windowMs, max: limits.writeMax,
      why: 'Too many saves for now. Try again in a minute.' });
    const looks = lookRoutes({ store, auth, bakes, dropFrames, previews: o.previews, loadLibrary: loaders.loadLibrary,
      codeGate: o.codeGate, limitWrites, log });
    const reports = reportRoutes(api, { reports: o.reports, build: o.build, tail: o.tail });
    routes(api, {
      'POST /signup': [signIn(201, (req) => auth.signup(parse(Signup, req.body))), { public: true }],
      'POST /login': [signIn(200, (req) => auth.login(Login.parse(req.body))), { public: true }],
      // A guest (SPEC-access "Guests"): a session with a name, and no account.
      'POST /guest': [async (req, reply) => {
        const [ip, made] = [await perIp(req), await perGuest(req)];
        const wait = !ip.isAllowed && ip.isExceeded ? ip.ttlInSeconds
          : !made.isAllowed && made.isExceeded ? made.ttlInSeconds : 0;
        if (wait) throw new HttpError(429, 'Too many attempts. Try again in a minute.', { 'Retry-After': `${wait}` });
        return start(auth.guest(parse(GuestBody, req.body).name), 201, req, reply);
      }, { public: true }],
      'POST /logout': [async (req, reply) => {
        auth.logout(req.cookies[COOKIE_NAME]);
        reply.setCookie(COOKIE_NAME, '', cookie(0));
        return { ok: true };
      }, { public: true }],
      ...tourRoutes({ store }),
      ...accountRoutes(api, { ...removal, limit: { max: limits.max, windowMs: limits.windowMs },
        clearCookie: (reply) => reply.setCookie(COOKIE_NAME, '', cookie(0)) }),
      ...peopleRoutes(removal),
      'GET /me': async (req) => ({ user: auth.publicUser(req.user), flash, rig }),
      ...lightRoutes({ light: o.light }),
      ...(o.baking ? bakingRoutes(o.baking) : {}),
      ...o.stats,
      ...reports,
      ...looks.routes,
      ...framesRoutes({ framesDir, cache: frames, visibleLook: looks.visibleLook }),
      'GET /library': [async () => ({ patterns: loaders.loadLibrary().filter((e) => !('hidden' in e && e.hidden))
        .map(({ name, title, summary, tags, kind, category, code, ...rest }) => ({ name, title, summary, tags, kind,
          category, code, ...(kind === 'preset' ? { layers: rest.layers, globals: rest.globals } : {}) })) }),
      { public: true }],
    });
  };
}
