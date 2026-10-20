// The bug report routes (SPEC "Bug reports"): anyone signed in files one, with its own body limit (a screenshot) and
// a limit per user; admins list and read them, and a report's screenshot.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { ReportBody } from '../shared/schemas/report.ts';
import type { Auth } from './auth.ts';
import { HttpError, parse } from './http.ts';
import type { Reports } from './reports/store.ts';

type Stored = NonNullable<ReturnType<Auth['authenticate']>>['user'];
export const REPORT_BODY = 3 * 2 ** 20;
const PER_HOUR = 10;

export function reportRoutes(api: FastifyInstance, { auth, reports, build, tail }: { auth: Auth, reports: Reports,
  build: string, tail: () => unknown[] }) {
  const perUser = api.createRateLimit({ timeWindow: 3_600_000, max: PER_HOUR,
    keyGenerator: (req) => `report|${req.user?.id}` });
  api.route({ method: 'POST', url: '/reports', bodyLimit: REPORT_BODY, handler: async (req, reply) => {
    const limit = await perUser(req);
    if (!limit.isAllowed && limit.isExceeded) {
      throw new HttpError(429, 'Too many reports for now. Try again later.',
        { 'Retry-After': `${limit.ttlInSeconds}` });
    }
    const user = req.user!;
    const id = await reports.save(parse(ReportBody, req.body), { user: { id: user.id, username: user.username },
      build, at: new Date().toISOString(), logs: tail() });
    reply.code(201);
    return { id };
  } });

  const admin = (req: FastifyRequest) => {
    if (!auth.isAdmin(req.user as Stored)) throw new HttpError(403, 'Only admins can read bug reports.');
    return (req.params as { id?: string }).id ?? '';
  };
  return {
    'GET /admin/reports': async (req: FastifyRequest) => { admin(req); return { reports: await reports.list() }; },
    'GET /admin/reports/:id': async (req: FastifyRequest) => {
      const report = await reports.get(admin(req));
      if (!report) throw new HttpError(404, 'No such report.');
      return { report };
    },
    'GET /admin/reports/:id/shot': async (req: FastifyRequest, reply: FastifyReply) => {
      const jpeg = await reports.shot(admin(req));
      if (!jpeg) throw new HttpError(404, 'That report has no screenshot.');
      return reply.type('image/jpeg').header('cache-control', 'private, no-store').send(jpeg);
    },
  };
}
