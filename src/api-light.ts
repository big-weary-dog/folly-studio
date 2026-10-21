// The light settings' routes (SPEC "Light and output"): everyone signed in reads them (Export and the preview use
// them); admins save them. Mutations pass the API's CSRF check like every other.
import type { FastifyRequest } from 'fastify';

import { forAdmins, HttpError } from './http.ts';
import type { LightStore } from './light.ts';

export function lightRoutes({ light }: { light: LightStore }) {
  return {
    'GET /light': async () => light.current(),
    'PUT /admin/light': forAdmins(async (req: FastifyRequest) => {
      const saved = light.save(req.body);
      if ('error' in saved) throw new HttpError(400, saved.error);
      return saved.light;
    }),
  };
}
