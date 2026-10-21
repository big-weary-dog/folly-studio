// Playing on the lights (SPEC-offline "Playing on the lights"): a saved look goes to the engine's queue through the
// feed, live (library modules by ref, no code) while the admin allows it, else as its current bake, else not at all.
// Custom code never reaches the engine. Under the Pi profile with PI_PREVIEW_URL only.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { can } from '../shared/policy.ts';
import type { LibraryEntry } from '../shared/schemas/rig.ts';
import { layersHash, renderFields } from './bake.ts';
import { forAdmins, HttpError, parse } from './http.ts';
import type { Hub } from './live/hub.ts';
import type { piFeed } from './live/pi-feed.ts';
import type { StoredLook as Look, StoredUser as User } from './store.ts';

/** As the engine holds them (pi/src/engine.ts MAX_QUEUE, pi/src/protocol.ts MAX_SEND). */
const MAX_QUEUE = 20, MAX_SEND = 64 * 1024;
const BAKE_IT = 'bake it (Check & bake) to play it on the lights.';
export type Play = { kind: 'live', look: object } | { kind: 'baked', id: string, title: string, sha256: string }
  | { error: string };

const Settings = z.object({ liveLooks: z.boolean() });
const Queue = z.object({ lookId: z.string().max(64), at: z.enum(['now', 'next', 'end']).optional() });

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
    return { kind: 'baked', id: look.id, title: look.title, sha256: b.frames.sha256 };
  }
  return { error: custom ? `Has custom code: ${BAKE_IT}` : `Live looks are off: ${BAKE_IT}` };
}

/** <STUDIO_DATA>/lights.json: whether live library looks may play (default on); a broken file is the default. */
export function createLightsStore(file: string) {
  const read = () => {
    try { return Settings.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch { return { liveLooks: true }; }
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

export function lightsRoutes({ file, feed, hub, loadLibrary, visibleLook }: { file: string,
  feed: Pick<ReturnType<typeof piFeed>, 'connected' | 'queued' | 'send'>, hub?: Pick<Hub, 'piDrove'>,
  loadLibrary: () => readonly LibraryEntry[], visibleLook: (id: string, user: User) => Look }) {
  const store = createLightsStore(file);
  const modules = () => new Set(loadLibrary().filter((e) => e.kind !== 'preset').map((e) => e.name));
  const state = (user: User) => ({ ...store.current(),
    canQueue: can({ id: user.id, role: user.role ?? 'member' }, 'curate'), engine: feed.connected() });
  return {
    // ?lookId: how that look would play ({ kind } or { error }), for the Play on the lights dialog.
    'GET /lights': async (req: FastifyRequest) => {
      const id = (req.query as { lookId?: unknown }).lookId;
      if (typeof id !== 'string') return state(req.user!);
      const play = playOf(visibleLook(id, req.user!), modules(), store.current().liveLooks);
      return { ...state(req.user!), play: 'error' in play ? play : { kind: play.kind } };
    },
    'POST /lights/queue': [async (req: FastifyRequest) => {
      const { lookId, at = 'end' } = parse(Queue, req.body);
      const play = playOf(visibleLook(lookId, req.user!), modules(), store.current().liveLooks);
      if ('error' in play) throw new HttpError(400, play.error);
      if (!feed.connected()) throw new HttpError(503, 'The lights\' engine is not running.');
      if (at !== 'now' && feed.queued() >= MAX_QUEUE) throw new HttpError(409, 'The queue is full.');
      feed.send({ type: 'send', at, by: req.user!.username, item: play });
      if (at === 'now') hub?.piDrove();
      return { kind: play.kind };
    }, { role: 'curator' }] as const,
    'PUT /admin/lights': forAdmins(async (req: FastifyRequest) => {
      store.save(parse(Settings, req.body));
      return state(req.user!);
    }),
  };
}
