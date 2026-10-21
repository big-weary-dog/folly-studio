// The access routes (SPEC-access): redeeming an invite code, limited per account and per address; for admins, the
// codes (made, listed, revoked) and the people (unlocked or locked, their limits raised, their count reset).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { InviteCreate, PersonPatch, Redeem } from '../shared/schemas/access.ts';
import type { AccessControl, Refusal, Refused } from './access.ts';
import { forAdmins, HttpError, parse } from './http.ts';
import type { Store, StoredUser } from './store.ts';

const WINDOW_MS = 15 * 60 * 1000;
const WHY: Record<Refused['refused'], string> = {
  unknown: 'That code is not valid: check it is typed or copied in full.',
  used: 'That code is used up: ask for a new one.',
  expired: 'That code has expired: ask for a new one.',
  revoked: 'That code was revoked: ask for a new one.',
};

/** A refusal from POST /api/ideas: its words, and the account's access so the form can show why. */
export const sendRefusal = (reply: FastifyReply, r: Refusal) => reply.code(r.status)
  .headers(r.retryAfter ? { 'Retry-After': `${r.retryAfter}` } : {}).send({ error: r.error, access: r.access });

export function accessRoutes(api: FastifyInstance, { access, store, limits = {} }: {
  access: AccessControl, store: Pick<Store, 'users'>, limits?: { tries?: number, ipTries?: number } }) {
  const window = { timeWindow: WINDOW_MS };
  const perIp = api.createRateLimit({ ...window, max: limits.ipTries ?? 20, keyGenerator: (req) => req.ip });
  const perUser = api.createRateLimit({ ...window, max: limits.tries ?? 5,
    keyGenerator: (req) => (req.user as StoredUser).id });
  const someone = (req: FastifyRequest) => {
    const u = store.users.get((req.params as { id: string }).id);
    if (!u) throw new HttpError(404, 'No such person.');
    return u;
  };
  return {
    'POST /invite': async (req: FastifyRequest) => {
      // Only failures count, so a room on one wifi can all redeem a good code.
      const [ip, mine] = [await perIp(req, { increment: false }), await perUser(req, { increment: false })];
      const wait = !ip.isAllowed && ip.remaining === 0 ? ip.ttlInSeconds
        : !mine.isAllowed && mine.remaining === 0 ? mine.ttlInSeconds : 0;
      if (wait) {
        throw new HttpError(429, 'Too many tries. Try again in a few minutes.', { 'Retry-After': `${wait}` });
      }
      let code;
      try { ({ code } = parse(Redeem, req.body)); } catch (err) { await perIp(req); throw err; }
      const now = access.redeem(req.user as StoredUser, code);
      if ('refused' in now) {
        await Promise.all([perUser(req), perIp(req)]);
        throw new HttpError(400, WHY[now.refused]);
      }
      return { access: now };
    },
    'GET /admin/invites': forAdmins(async () => ({ invites: access.invites() })),
    'POST /admin/invites': forAdmins(async (req: FastifyRequest, reply: FastifyReply) => {
      reply.code(201);
      return access.createInvite(req.user!.username, parse(InviteCreate, req.body));
    }),
    'DELETE /admin/invites/:id': forAdmins(async (req: FastifyRequest) => {
      const invite = access.revoke((req.params as { id: string }).id);
      if (!invite) throw new HttpError(404, 'No such invite code.');
      return { invite };
    }),
    'GET /admin/people': forAdmins(async () => ({ people: store.users.list()
      .sort((a, b) => a.username.localeCompare(b.username)).map((u) => access.person(u)) })),
    'PUT /admin/people/:id': forAdmins(async (req: FastifyRequest) => {
      const body = parse(PersonPatch, req.body);
      return { person: access.person(access.patch(someone(req), req.user!.username, body)) };
    }),
  };
}
