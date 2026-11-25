// An account's own settings (SPEC-access "Your account"): a new password, or the account deleted with its looks and
// ideas. Each needs the password; wrong ones are limited per address and account, as failed sign-ins are.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { AccountDelete, PasswordChange } from '../shared/schemas/api.ts';
import { type Auth, COOKIE_NAME } from './auth.ts';
import { HttpError, type Logger, parse } from './http.ts';
import type { Hub } from './live/hub.ts';
import type { Store } from './store.ts';

export function accountRoutes(api: FastifyInstance, { store, auth, dropFrames, hub, previews, clearCookie, limit,
  log = console }: { store: Store, auth: Auth, dropFrames: (id: string) => Promise<unknown>,
  hub: Pick<Hub, 'forget'>, previews?: { drop(id: string): Promise<unknown> },
  /** Clears the session cookie on `reply`. */ clearCookie: (reply: FastifyReply) => void,
  limit: { max: number, windowMs: number }, log?: Logger }) {
  const failures = api.createRateLimit({ timeWindow: limit.windowMs, max: limit.max,
    keyGenerator: (req) => `password|${req.ip}|${req.user?.id}` });
  /** Runs `work` once the request's password is the account's: past the failures, 429; a wrong one counts. */
  const withPassword = async <T>(req: FastifyRequest, password: string, work: () => Promise<T>) => {
    const now = await failures(req, { increment: false });
    if (!now.isAllowed && now.remaining === 0) {
      throw new HttpError(429, 'Too many attempts. Try again in a minute.', { 'Retry-After': `${now.ttlInSeconds}` });
    }
    await auth.confirm(req.user!, password).catch(async (err) => {
      if (err instanceof HttpError && err.status === 403) await failures(req);
      throw err;
    });
    return work();
  };

  return {
    'PUT /me/password': async (req: FastifyRequest) => {
      const body = parse(PasswordChange, req.body);
      await withPassword(req, body.password, () => auth.changePassword(req.user!, body, req.cookies[COOKIE_NAME]));
      return { ok: true };
    },
    // The account, its sessions, ideas and looks (shared ones too, off the stage), and the looks' frames and previews.
    'DELETE /me': async (req: FastifyRequest, reply: FastifyReply) => {
      const { password } = parse(AccountDelete, req.body);
      const user = req.user!;
      await withPassword(req, password, async () => {
        const looks = store.looks.list((l) => l.owner === user.id).map((l) => l.id);
        for (const id of looks) store.looks.remove(id);
        for (const idea of store.ideas.list((i) => i.owner === user.id)) store.ideas.remove(idea.id);
        auth.removeUser(user.id);
        hub.forget(new Set(looks));
        await Promise.all(looks.map((id) => Promise.all([dropFrames(id), previews?.drop(id)]).catch((err) => {
          log.error?.(`account: could not remove the frames or previews of look ${id}:`, err);
        })));
      });
      clearCookie(reply);
      return { ok: true };
    },
  };
}
