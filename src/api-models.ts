// The models routes (SPEC "HTTP API"): what a user may pick for an idea; for admins, the registry file itself, with
// whether each model can run here, and saving it. Mutations pass the API's CSRF check like every other.
import type { FastifyRequest } from 'fastify';

import { DEEP } from '../shared/schemas/api.ts';
import type { AccessControl } from './access.ts';
import type { Auth } from './auth.ts';
import type { Registry } from './generate/models.ts';
import { HttpError } from './http.ts';

type Stored = NonNullable<ReturnType<Auth['authenticate']>>['user'];

export function modelRoutes({ auth, models, access }: { auth: Auth, models: Registry, access: AccessControl }) {
  const admin = (req: FastifyRequest) => {
    if (!auth.isAdmin(req.user as Stored)) throw new HttpError(403, 'Only admins can see and change the models.');
  };
  return {
    // A locked account starts on the free model.
    'GET /models': async (req: FastifyRequest) => ({ ...models.choices(auth.roleOf(req.user),
      { paid: access.state(req.user as Stored).unlocked }), ...(DEEP.enabled ? { deep: DEEP } : {}) }),
    'GET /admin/models': async (req: FastifyRequest) => {
      admin(req);
      return models.admin();
    },
    'PUT /admin/models': async (req: FastifyRequest) => {
      admin(req);
      const saved = models.save(req.body);
      if ('error' in saved) throw new HttpError(400, saved.error);
      return saved;
    },
  };
}
