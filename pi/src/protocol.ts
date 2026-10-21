// The control page's socket (pi/README.md "The control page"): what the page (and Studio's feed) may send, checked
// here, and the state the Pi sends back about ten times a second. Shared by the server and the page.
import { z } from 'zod';

import type { PiSource } from '../../shared/schemas/live.ts';

const At = z.enum(['now', 'next', 'end']);

export const FromPage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), pin: z.string().max(32).optional() }),
  z.object({ type: z.literal('play'), id: z.string().max(64) }),
  z.object({ type: z.literal('set'), name: z.string().max(64), value: z.number().finite() }),
  /** A tap at the page's clock (ms): the tempo comes from the page's spacing, free of the network's jitter. */
  z.object({ type: z.literal('tap'), at: z.number().finite() }),
  z.object({ type: z.literal('level'), value: z.number().min(0).max(1) }),
  z.object({ type: z.literal('blackout'), on: z.boolean() }),
  // The queue (SPEC-offline "Playing on the lights"): one of the engine's own looks, a look Studio sent, and moves.
  z.object({ type: z.literal('queue'), id: z.string().max(64), at: At.optional() }),
  z.object({ type: z.literal('unqueue'), key: z.string().max(16) }),
  z.object({ type: z.literal('move'), key: z.string().max(16), to: z.number().int().min(0).max(64) }),
  z.object({ type: z.literal('next') }),
  /** From Studio's feed: a library-only look (modules by ref), resolved against the engine's library. */
  z.object({ type: z.literal('send'), at: At.optional(), by: z.string().max(64).optional(),
    item: z.object({ kind: z.literal('live'), look: z.looseObject({}) }) }),
]);
/** The most a `send` may be; every other message is held to 1 KB. */
export const MAX_SEND = 64 * 1024;
export type FromPage = z.infer<typeof FromPage>;

export type Control = { name: string, min: number, max: number, value: number, kind: 'macro' | 'bpm' };
export type QueueItem = { key: string, id: string, title: string, kind: 'look' | 'live', by?: string };
export type PiState = {
  /** rev: its source's (below); offset, beat0 and paces: the prepared look's clocks, so a viewer renders the same
   * frame. */
  /** kind: where it came from (QueueItem); left: seconds of its pattern to play, null while nothing is queued. */
  look: { id: string, rev: number, title: string, kind: QueueItem['kind'], t: number, duration: number,
    left: number | null, bpm: number, beats: number,
    offset: number, beat0: number, paces: Record<string, number>, controls: Control[] } | null,
  /** The output's gain now: the master, blackout and a switch's dip, each as eased. */
  gain: number,
  level: number, blackout: boolean, tripped: { at: string, look: string } | null,
  /** paused: the flash guard tripped, and the queue waits for a person. */
  paused: boolean, switching: { id: string, title: string } | null, queue: QueueItem[],
  looks: { id: string, title: string, playable: boolean, error?: string }[],
  out: { dryRun: boolean, fps: number, renderMs: number, genW: number, genPeakW: number, gen: number, cut: number,
    ddpErrors: number, lastError: string },
};
export type ToPage =
  | { type: 'hello', ok: boolean, needPin: boolean, error?: string }
  | { type: 'state', state: PiState }
  /** What plays (layers by ref, no code), on hello and at each change: for Studio's Live tab following /pi. */
  | { type: 'source', source: PiSource }
  /** Behind Studio's proxy only: who drives its Live tab, this page or Live control. */
  | { type: 'driver', from: 'pi' | 'live' }
  | { type: 'error', error: string };
