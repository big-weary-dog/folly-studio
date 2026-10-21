// Playing on the lights (SPEC-offline "Playing on the lights"): a saved look goes to the engine's queue through the
// feed, live (library modules by ref, no code) while the admin allows it, else as its current bake, else not at all.
// Custom code never reaches the engine. The admin's mode (SPEC-liveplay "Modes") goes to the engine through the feed.
// Under the Pi profile with PI_PREVIEW_URL only.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { can } from '../shared/policy.ts';
import type { LibraryEntry } from '../shared/schemas/rig.ts';
import { bakeSeconds, layersHash, renderFields } from './bake.ts';
import { forAdmins, HttpError, parse } from './http.ts';
import type { Hub } from './live/hub.ts';
import type { piFeed } from './live/pi-feed.ts';
import type { StoredLook as Look, StoredUser as User } from './store.ts';

/** As the engine holds them (pi/src/engine.ts MAX_QUEUE, pi/src/protocol.ts MAX_SEND). */
const MAX_QUEUE = 20, MAX_SEND = 64 * 1024;
const BAKE_IT = 'bake it (Check & bake) to play it on the lights.';
export const JUKEBOX_NOW = 'The lights are in Jukebox: Play next or Add to the end';
export type Play = { kind: 'live', look: object }
  | { kind: 'baked', id: string, title: string, sha256: string, duration: number } | { error: string };

const Mode = z.enum(['jukebox', 'live']);
export type Mode = z.infer<typeof Mode>;
const Settings = z.object({ liveLooks: z.boolean(), mode: Mode.default('jukebox') });
/** What PUT changes: either or both. */
const Change = z.object({ liveLooks: z.boolean().optional(), mode: Mode.optional() });
const From = z.object({ from: z.enum(['mine', 'gallery']).default('mine') });
const Queue = z.object({ lookId: z.string().max(64), at: z.enum(['now', 'next', 'end']).optional(),
  fade: z.number().min(0.25).max(8).optional() });

/** How `look` may play: live when every module is a library one (and live looks are on), else its current bake. */
export function playOf(look: Look, library: ReadonlySet<string>, liveLooks: boolean): Play {
  const layers = look.layers as { code?: unknown, modules?: { ref?: unknown, code?: unknown }[] }[];
  const custom = layers.some((l) => !Array.isArray(l.modules) || !l.modules.length
    || l.modules.some((m) => typeof m.ref !== 'string' || !library.has(m.ref)));
  if (!custom && liveLooks) {
    const sent = { id: look.id, title: look.title, duration: look.duration, bpm: look.bpm,
      globals: look.globals ?? null, automation: look.automation ?? null,
      layers: layers.map(({ code: _, ...l }) => ({ ...l, modules: l.modules!.map(({ code: __, ...m }) => m) })) };
    if (JSON.stringify(sent).length < MAX_SEND - 1024) return { kind: 'live', look: sent };
  }
  const b = look.bake;
  if (b?.status === 'done' && b.ok && b.frames?.sha256 && b.layersHash === layersHash(renderFields(look))) {
    return { kind: 'baked', id: look.id, title: look.title, sha256: b.frames.sha256,
      duration: b.seconds ?? bakeSeconds(look) };
  }
  return { error: custom ? `Has custom code: ${BAKE_IT}` : `Live looks are off: ${BAKE_IT}` };
}

/** <STUDIO_DATA>/lights.json: whether live library looks may play (default on) and the mode (default Jukebox); a
 * broken file is the default. */
export function createLightsStore(file: string) {
  const read = (): z.infer<typeof Settings> => {
    try { return Settings.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch {
      return { liveLooks: true, mode: 'jukebox' };
    }
  };
  return {
    current: read,
    save(next: z.infer<typeof Settings>) {
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(next)}\n`);
      renameSync(tmp, file);
      return next;
    },
  };
}

export type LightsStore = ReturnType<typeof createLightsStore>;

/** `drive`: may this person drive Live Play (SPEC-live "Settings", STUDIO_LIVE_CONTROL). */
export function lightsRoutes({ store, feed, hub, drive, loadLibrary, visibleLook, looksIn, listed }: {
  store: LightsStore,
  feed: Pick<ReturnType<typeof piFeed>, 'connected' | 'queued' | 'send' | 'mode'>, hub?: Pick<Hub, 'piDrove'>,
  drive: (user: User) => boolean, loadLibrary: () => readonly LibraryEntry[],
  visibleLook: (id: string, user: User) => Look, looksIn: (scope: 'mine' | 'gallery', user: User) => Look[],
  listed: (look: Look) => { ownerName: string, duration: number, preview?: string } }) {
  const modules = () => new Set(loadLibrary().filter((e) => e.kind !== 'preset').map((e) => e.name));
  const state = (user: User) => ({ ...store.current(),
    canQueue: can({ id: user.id, role: user.role ?? 'member' }, 'curate'), canDrive: drive(user),
    engine: feed.connected() });
  return {
    // ?lookId: how that look would play ({ kind } or { error }), for the Play on the lights dialog.
    'GET /lights': async (req: FastifyRequest) => {
      const id = (req.query as { lookId?: unknown }).lookId;
      if (typeof id !== 'string') return state(req.user!);
      const play = playOf(visibleLook(id, req.user!), modules(), store.current().liveLooks);
      return { ...state(req.user!), play: 'error' in play ? play : { kind: play.kind } };
    },
    // The live page's sources: each look with how it would play, so one that cannot shows why.
    'GET /lights/looks': [async (req: FastifyRequest) => {
      const { from } = parse(From, req.query), lib = modules(), live = store.current().liveLooks;
      return { looks: looksIn(from, req.user!).map((l) => {
        const play = playOf(l, lib, live), { ownerName, duration, preview } = listed(l);
        return { id: l.id, title: l.title, ownerName, duration, ...preview ? { preview } : {},
          play: 'error' in play ? play : { kind: play.kind } };
      }) };
    }, { role: 'curator' }] as const,
    'POST /lights/queue': [async (req: FastifyRequest) => {
      const { lookId, at = 'end', fade } = parse(Queue, req.body);
      const play = playOf(visibleLook(lookId, req.user!), modules(), store.current().liveLooks);
      if ('error' in play) throw new HttpError(400, play.error);
      if (at === 'now' && store.current().mode === 'jukebox') throw new HttpError(409, JUKEBOX_NOW);
      if (at === 'now' && !drive(req.user!)) throw new HttpError(403, 'Playing a look now is for those who drive.');
      if (!feed.connected()) throw new HttpError(503, 'The lights\' engine is not running.');
      if (at !== 'now' && feed.queued() >= MAX_QUEUE) throw new HttpError(409, 'The queue is full.');
      feed.send({ type: 'send', at, ...fade ? { fade } : {}, by: req.user!.username, item: play });
      if (at === 'now') hub?.piDrove();
      return { kind: play.kind };
    }, { role: 'curator' }] as const,
    'PUT /admin/lights': forAdmins(async (req: FastifyRequest) => {
      const next = store.save({ ...store.current(), ...parse(Change, req.body) });
      feed.mode(next.mode);
      return state(req.user!);
    }),
  };
}
