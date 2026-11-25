// A limit on what one account does in a window (@fastify/rate-limit): look writes, bug reports. Past it, 429 with
// Retry-After.
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { HttpError } from './http.ts';

/** A check that counts the request against its account's `max` in `windowMs` and throws 429 `why` past it. */
export function perAccount(api: FastifyInstance, { name, max, windowMs, why }: { name: string, max: number,
  windowMs: number, why: string }) {
  const limit = api.createRateLimit({ timeWindow: windowMs, max, keyGenerator: (req) => `${name}|${req.user?.id}` });
  return async (req: FastifyRequest) => {
    const now = await limit(req);
    if (!now.isAllowed && now.isExceeded) throw new HttpError(429, why, { 'Retry-After': `${now.ttlInSeconds}` });
  };
}
