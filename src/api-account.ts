// An account's own settings (SPEC-access "Your account"): a new password, or the account deleted with its looks and
// ideas. Each needs the password; wrong ones are limited per address and account, as failed sign-ins are.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { AccountDelete, PasswordChange } from '../shared/schemas/api.ts';
import { COOKIE_NAME } from './auth.ts';
import { removeAccount, type Removal } from './account-removal.ts';
import { HttpError, parse } from './http.ts';

export function accountRoutes(api: FastifyInstance, { clearCookie, limit, ...removal }: Removal & {
  /** Clears the session cookie on `reply`. */ clearCookie: (reply: FastifyReply) => void,
  limit: { max: number, windowMs: number } }) {
  const { auth } = removal;
  const failures = api.createRateLimit({ timeWindow: limit.windowMs, max: limit.max,
    keyGenerator: (req) => `password|${req.ip}|${req.user?.id}` });
  /** Runs `work` once the request's password is the account's: past the failures, 429; a wrong one counts. */
  const withPassword = async <T>(req: FastifyRequest, password: string, work: () => Promise<T>) => {
    const now = await failures(req, { increment: false });
    if (!now.isAllowed && now.remaining === 0) {
      throw new HttpError(429, 'Too many attempts. Try again in a minute.', { 'Retry-After': `${now.ttlInSeconds}` });
    }
    await auth.confirm(req.user!, password, req.cookies[COOKIE_NAME]).catch(async (err) => {
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
    'DELETE /me': async (req: FastifyRequest, reply: FastifyReply) => {
      const { password } = parse(AccountDelete, req.body);
      await withPassword(req, password, () => removeAccount(removal, req.user!.id));
      clearCookie(reply);
      return { ok: true };
    },
  };
}
