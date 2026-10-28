// The live stage's routes under /api (SPEC-live): its socket, a snapshot, and the looks a controller may play. Who
// may control and what may play are the host's settings (STUDIO_LIVE_CONTROL, STUDIO_LIVE_LOOKS).
import { socketOrigin } from '../socket-origin.ts';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { upgradeGlobals } from '../../public/js/pattern-core.ts';
import type { Listed } from '../../shared/schemas/api.ts';
import type { LiveLook, LiveSettings } from '../../shared/schemas/live.ts';
import { playsOf } from '../../shared/schemas/look.ts';
import type { Auth } from '../auth.ts';
import { serverNow } from '../clock.ts';
import { type Config, configOf } from '../config.ts';
import { HttpError } from '../http.ts';
import type { Store, StoredLook } from '../store.ts';
import type { Hub } from './hub.ts';

type Stored = NonNullable<FastifyRequest['user']>;

/** The settings (STUDIO_LIVE_CONTROL, STUDIO_LIVE_LOOKS): curators and reviewed looks when unset. */
export function liveSettings(c: Config = configOf()): LiveSettings {
  return { control: c.STUDIO_LIVE_CONTROL ?? 'curators', looks: c.STUDIO_LIVE_LOOKS ?? 'reviewed' };
}

/** May this look play on the stage under these settings? */
export const playableLook = (look: StoredLook | null, settings: LiveSettings) => !!look && look.shared === true
  && (settings.looks === 'shared' || look.reviewed === true) && Array.isArray(look.layers);

/** The stage's copy of a stored look, its globals as they play now (upgradeGlobals). */
export const stageCopy = (look: StoredLook, ownerName: string): LiveLook => upgradeGlobals({ id: look.id,
  title: look.title, ownerName, globals: null, automation: null, ...playsOf(look) });

/** May this person control the live stage, and drive Live Play on the lights (STUDIO_LIVE_CONTROL)? */
export const controlFor = (auth: Pick<Auth, 'can'>, settings: LiveSettings) => (user: Stored) => (!user.guest
  && (settings.control === 'members' || auth.can(user, settings.control === 'admins' ? 'admin' : 'curate')));

export function liveRoutes({ store, auth, hub, settings, listed }: { store: Store, auth: Auth, hub: Hub,
  settings: LiveSettings, listed: (look: StoredLook) => Listed }) {
  const mayControl = controlFor(auth, settings);
  return async (api: FastifyInstance) => {
    api.get('/live', (req) => ({ live: hub.live, now: serverNow(), control: mayControl(req.user!) }));
    api.get('/live/looks', (req) => {
      if (!mayControl(req.user!)) throw new HttpError(403, 'Only controllers pick what plays.');
      return { looks: store.looks.list((l) => playableLook(l, settings)).map(listed)
        .sort((a, b) => a.title.localeCompare(b.title)) };
    });
    api.get('/live/socket', {
      websocket: true,
      // Browsers always send Origin on a socket: it must be this site (CSRF over WebSockets).
      preValidation: async (req) => {
        if (!socketOrigin(req.headers.origin, req.host)) throw new HttpError(403, 'Cross-origin socket refused.');
      },
    }, (socket, req) => {
      const user = req.user!;
      hub.join(socket, { id: user.id, username: user.username }, mayControl(user));
    });
  };
}
