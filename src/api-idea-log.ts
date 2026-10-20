// The idea log routes (SPEC "HTTP API"), for admins only: an idea's or refinement's log (generate/idea-log.ts), and
// the stills its model was shown, by the strict file names the log writes.
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { Auth } from './auth.ts';
import { type IdeaLogs, isStillName } from './generate/idea-log.ts';
import { HttpError } from './http.ts';

type Stored = NonNullable<ReturnType<Auth['authenticate']>>['user'];
type Params = { id: string, name?: string };

export function ideaLogRoutes({ auth, logs }: { auth: Auth, logs: IdeaLogs }) {
  const admin = (req: FastifyRequest) => {
    if (!auth.isAdmin(req.user as Stored)) throw new HttpError(403, 'Only admins can read idea logs.');
    return req.params as Params;
  };
  return {
    'GET /admin/ideas/:id/log': async (req: FastifyRequest) => {
      const log = await logs.read(admin(req).id);
      if (!log) throw new HttpError(404, 'That idea has no log.');
      return log;
    },
    'GET /admin/ideas/:id/log/stills/:name': async (req: FastifyRequest, reply: FastifyReply) => {
      const { id, name = '' } = admin(req);
      if (!isStillName(name)) throw new HttpError(400, 'Not a still\'s name.');
      const png = await logs.still(id, name);
      if (!png) throw new HttpError(404, 'No such still.');
      return reply.type('image/png').header('cache-control', 'private, no-store').send(png);
    },
  };
}
