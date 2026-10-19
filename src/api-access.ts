// The access routes (SPEC "Access"): redeeming an invite code, limited per account and per address; for admins, the
// codes (made, listed, revoked) and the people (unlocked or locked, their limits raised, their count reset).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { InviteCreate, PersonPatch, Redeem } from '../shared/schemas/access.ts';
import type { AccessControl, Refusal } from './access.ts';
import type { Auth } from './auth.ts';
import { HttpError, parse } from './http.ts';
import type { Store, StoredUser } from './store.ts';

const WINDOW_MS = 15 * 60 * 1000;

/** A refusal from POST /api/ideas: its words, and the account's access so the form can show why. */
export const sendRefusal = (reply: FastifyReply, r: Refusal) => reply.code(r.status)
  .headers(r.retryAfter ? { 'Retry-After': `${r.retryAfter}` } : {}).send({ error: r.error, access: r.access });

export function accessRoutes(api: FastifyInstance, { auth, access, store, limits = {} }: { auth: Auth,
  access: AccessControl, store: Pick<Store, 'users'>, limits?: { tries?: number, ipTries?: number } }) {
  const window = { timeWindow: WINDOW_MS };
  const perIp = api.createRateLimit({ ...window, max: limits.ipTries ?? 20, keyGenerator: (req) => req.ip });
  const perUser = api.createRateLimit({ ...window, max: limits.tries ?? 5,
    keyGenerator: (req) => (req.user as StoredUser).id });
  const admin = (req: FastifyRequest) => {
    if (!auth.isAdmin(req.user as StoredUser)) throw new HttpError(403, 'Only admins can manage access.');
    return req.user as StoredUser;
  };
  const someone = (req: FastifyRequest) => {
    const u = store.users.get((req.params as { id: string }).id);
    if (!u) throw new HttpError(404, 'No such person.');
    return u;
  };
  return {
    'POST /invite': async (req: FastifyRequest) => {
      const [ip, mine] = [await perIp(req), await perUser(req, { increment: false })];
      const wait = !ip.isAllowed && ip.isExceeded ? ip.ttlInSeconds
        : !mine.isAllowed && mine.remaining === 0 ? mine.ttlInSeconds : 0;
      if (wait) {
        throw new HttpError(429, 'Too many tries. Try again in a few minutes.', { 'Retry-After': `${wait}` });
      }
      const { code } = parse(Redeem, req.body);
      const now = access.redeem(req.user as StoredUser, code);
      if (!now) {
        await perUser(req);
        throw new HttpError(400, 'That code is not valid: it may be mistyped, used up, expired or revoked.');
      }
      return { access: now };
    },
    'GET /admin/invites': async (req: FastifyRequest) => (admin(req), { invites: access.invites() }),
    'POST /admin/invites': async (req: FastifyRequest, reply: FastifyReply) => {
      const by = admin(req).username;
      reply.code(201);
      return access.createInvite(by, parse(InviteCreate, req.body));
    },
    'DELETE /admin/invites/:id': async (req: FastifyRequest) => {
      admin(req);
      const invite = access.revoke((req.params as { id: string }).id);
      if (!invite) throw new HttpError(404, 'No such invite code.');
      return { invite };
    },
    'GET /admin/people': async (req: FastifyRequest) => {
      admin(req);
      return { people: store.users.list().sort((a, b) => a.username.localeCompare(b.username))
        .map((u) => access.person(u)) };
    },
    'PUT /admin/people/:id': async (req: FastifyRequest) => {
      const by = admin(req).username;
      const body = parse(PersonPatch, req.body);
      return { person: access.person(access.patch(someone(req), by, body)) };
    },
  };
}
