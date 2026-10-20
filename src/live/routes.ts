// The live stage's routes under /api (SPEC-live): its socket, a snapshot, and the looks a controller may play. Who
// may control and what may play are the host's settings (STUDIO_LIVE_CONTROL, STUDIO_LIVE_LOOKS).
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Listed } from '../../shared/schemas/api.ts';
import type { LiveLook, LiveSettings } from '../../shared/schemas/live.ts';
import type { Auth } from '../auth.ts';
import { serverNow } from '../clock.ts';
import { HttpError } from '../http.ts';
import type { Store, StoredLook } from '../store.ts';
import type { Hub } from './hub.ts';

type Stored = NonNullable<FastifyRequest['user']>;

/** The settings from the environment: unknown values fall back to the defaults (curators; reviewed looks). */
export function liveSettings(env: NodeJS.ProcessEnv = process.env): LiveSettings {
  const control = String(env.STUDIO_LIVE_CONTROL ?? '').trim().toLowerCase();
  const looks = String(env.STUDIO_LIVE_LOOKS ?? '').trim().toLowerCase();
  return { control: control === 'admins' || control === 'members' ? control : 'curators',
    looks: looks === 'shared' ? 'shared' : 'reviewed' };
}

/** May this look play on the stage under these settings? */
export const playableLook = (look: StoredLook | null, settings: LiveSettings) => !!look && look.shared === true
  && (settings.looks === 'shared' || look.reviewed === true) && Array.isArray(look.layers);

/** The stage's copy of a stored look. */
export const stageCopy = (look: StoredLook, ownerName: string): LiveLook => ({ id: look.id, title: look.title,
  ownerName, layers: look.layers ?? [], duration: look.duration ?? 30, ...(look.bpm ? { bpm: look.bpm } : {}),
  globals: look.globals ?? null, automation: look.automation ?? null });

export function liveRoutes({ store, auth, hub, settings, listed }: { store: Store, auth: Auth, hub: Hub,
  settings: LiveSettings, listed: (look: StoredLook) => Listed }) {
  const mayControl = (user: Stored) => (settings.control === 'members' ? true
    : settings.control === 'admins' ? auth.isAdmin(user) : auth.isCurator(user));
  const host = (h: string) => h.toLowerCase().replace(/:(80|443)$/, '');
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
        let from = '';
        try { from = new URL(String(req.headers.origin)).host; } catch { /* missing or "null" */ }
        if (!from || host(from) !== host(req.host)) throw new HttpError(403, 'Cross-origin socket refused.');
      },
    }, (socket, req) => {
      const user = req.user!;
      hub.join(socket, { id: user.id, username: user.username }, mayControl(user));
    });
  };
}
