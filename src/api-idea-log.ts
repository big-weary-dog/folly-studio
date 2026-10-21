// The idea log routes (SPEC "HTTP API"), for admins only: an idea's or refinement's log (generate/idea-log.ts), and
// the stills its model was shown, by the strict file names the log writes.
import type { FastifyReply, FastifyRequest } from 'fastify';

import { type IdeaLogs, isStillName } from './generate/idea-log.ts';
import { forAdmins, HttpError } from './http.ts';

type Params = { id: string, name?: string };

export function ideaLogRoutes({ logs }: { logs: IdeaLogs }) {
  return {
    'GET /admin/ideas/:id/log': forAdmins(async (req: FastifyRequest) => {
      const log = await logs.read((req.params as Params).id);
      if (!log) throw new HttpError(404, 'That idea has no log.');
      return log;
    }),
    'GET /admin/ideas/:id/log/stills/:name': forAdmins(async (req: FastifyRequest, reply: FastifyReply) => {
      const { id, name = '' } = req.params as Params;
      if (!isStillName(name)) throw new HttpError(400, 'Not a still\'s name.');
      const png = await logs.still(id, name);
      if (!png) throw new HttpError(404, 'No such still.');
      return reply.type('image/png').header('cache-control', 'private, no-store').send(png);
    }),
  };
}
