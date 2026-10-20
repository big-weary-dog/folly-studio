// The live stage (SPEC-live.md): what a socket's client may send, parsed on the server, and the state and messages
// the server sends, as types for the browser (`import type`).
import { z } from 'zod';

import type { Automation, Globals, Layer } from './look.ts';

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const value = z.number().finite();
const LayerSet = z.strictObject({ level: z.number().min(0).max(1).optional(), muted: z.boolean().optional() });

/** What a client sends (SPEC-live "Socket"); anything else is refused with an error message. */
export const FromClient = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ping'), id: z.number().int().min(0).max(2 ** 31) }),
  z.strictObject({ type: z.literal('sync') }),
  z.strictObject({ type: z.literal('play'), lookId: z.string().regex(ID) }),
  z.strictObject({
    type: z.literal('set'),
    values: z.record(z.string().regex(NAME), value).refine((v) => Object.keys(v).length <= 24).optional(),
    release: z.array(z.string().regex(NAME)).max(24).optional(),
    layers: z.record(z.string().regex(ID), LayerSet).refine((v) => Object.keys(v).length <= 16).optional(),
    blackout: z.boolean().optional(),
  }),
]);
export type FromClient = z.infer<typeof FromClient>;

/** A lane's points: [show time in the loop, value]. */
export type Points = [number, number][];
export type LiveLayer = { level?: number, muted?: boolean };
/** The look on stage: copied from the stored look when it was switched to. */
export type LiveLook = { id: string, title: string, ownerName: string, layers: Layer[], duration: number,
  bpm?: number, globals?: Globals | null, automation?: Automation | null };
export type Live = { rev: number, look: LiveLook | null, startedAt: number, loop: number,
  held: Record<string, number>, lanes: Record<string, Points>, drop: string[], layers: Record<string, LiveLayer>,
  blackout: boolean, by: { id: string, username: string } | null, updatedAt: number,
  /** Who drives the stage: its controllers, or /pi's engine (SPEC-live "Following /pi"); the last to use one. */
  driver: 'stage' | 'pi' };
/** A change: the lanes that changed (null: gone), the whole `held` and `drop`. */
export type LiveUpdate = { type: 'update', rev: number, at: number, loop: number, held: Live['held'],
  drop: string[], lanes: Record<string, Points | null>, layers?: Live['layers'], blackout?: boolean,
  by: Live['by'] };
/** What /pi's engine plays, sent when it changes: the look with its modules by library ref, and its automation. */
export type PiSource = { rev: number, id: string, title: string, duration: number, bpm?: number,
  globals?: Globals | null, automation?: Automation | null, layers: Layer[] };
/** How it plays it at server time `at`: show time t, the clock (offset, beat0, bpm), the values pushed, the gain. */
export type PiNow = { rev: number, t: number, bpm: number, beat0: number, offset: number,
  values: Record<string, number>, gain: number };
export type FromServer = { type: 'pong', id: number, now: number }
  | { type: 'pi', at: number, now: PiNow | null, source?: PiSource }
  | { type: 'state', live: Live, now: number, control: boolean } | LiveUpdate
  | { type: 'presence', viewers: number, controllers: string[] } | { type: 'error', error: string };

/** Who may control and what may play (STUDIO_LIVE_CONTROL, STUDIO_LIVE_LOOKS). */
export type LiveSettings = { control: 'curators' | 'admins' | 'members', looks: 'reviewed' | 'shared' };
