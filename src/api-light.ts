// The light settings' routes (SPEC "Light and output"): everyone signed in reads them (Export and the preview use
// them); admins save them. Mutations pass the API's CSRF check like every other.
import type { FastifyRequest } from 'fastify';

import type { Auth } from './auth.ts';
import { HttpError } from './http.ts';
import type { LightStore } from './light.ts';

type Stored = NonNullable<ReturnType<Auth['authenticate']>>['user'];

export function lightRoutes({ auth, light }: { auth: Auth, light: LightStore }) {
  return {
    'GET /light': async () => light.current(),
    'PUT /admin/light': async (req: FastifyRequest) => {
      if (!auth.isAdmin(req.user as Stored)) throw new HttpError(403, 'Only admins can change the light settings.');
      const saved = light.save(req.body);
      if ('error' in saved) throw new HttpError(400, saved.error);
      return saved.light;
    },
  };
}
