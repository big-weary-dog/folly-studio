// The tutorial's route (SPEC "HTTP API"): a signed-in person saves where they are in it, on their own account.
import type { FastifyRequest } from 'fastify';

import { Tour } from '../shared/schemas/tour.ts';
import { parse } from './http.ts';
import type { Store } from './store.ts';

export function tourRoutes({ store }: { store: Pick<Store, 'users'> }) {
  return {
    'PUT /me/tour': async (req: FastifyRequest) => {
      const tour = parse(Tour, req.body);
      store.users.update(req.user!.id, { tour });
      return { tour };
    },
  };
}
