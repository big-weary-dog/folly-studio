// Where /live on the Pi finds looks for the lights (SPEC-liveplay "The page"): one's own and the gallery's, each with
// how it would play (GET /api/lights/looks), added through Studio (POST /api/lights/queue), then the lights' own.
import { ownSource, type Source, type Tile } from '../../../../pi/page/add.tsx';
import type { PiSocket } from '../../../../pi/page/socket.ts';
import { api, type LightsLook } from '../../api.ts';

/** The server's reason, said in the few words a tile has room for. */
const short = (error: string) => (/custom code/i.test(error) ? 'Custom code: needs a bake'
  : /live looks are off/i.test(error) ? 'Live looks are off: needs a bake' : error);

const tile = (l: LightsLook): Tile => ({ id: l.id, title: l.title, by: l.ownerName, duration: l.duration,
  ...'error' in l.play ? { error: short(l.play.error) } : { kind: l.play.kind } });

const studio = (from: 'mine' | 'gallery', label: string): Source => ({
  label,
  load: () => api.lightsLooks(from).then((r) => r.looks.map(tile)),
  add: (t, at, fade) => api.playOnLights(t.id, at, fade),
});

export const studioSources = (sock: PiSocket): Source[] =>
  [studio('mine', 'Mine'), studio('gallery', 'Gallery'), ownSource(sock)];
