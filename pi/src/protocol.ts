// The control page's socket (pi/README.md "The control page"): what the page may send, checked here, and the state
// the Pi sends back about ten times a second. Shared by the server and the page.
import { z } from 'zod';

import type { PiSource } from '../../shared/schemas/live.ts';

export const FromPage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), pin: z.string().max(32).optional(), feed: z.boolean().optional() }),
  z.object({ type: z.literal('play'), id: z.string().max(64) }),
  z.object({ type: z.literal('set'), name: z.string().max(64), value: z.number().finite() }),
  /** A tap at the page's clock (ms): the tempo comes from the page's spacing, free of the network's jitter. */
  z.object({ type: z.literal('tap'), at: z.number().finite() }),
  z.object({ type: z.literal('level'), value: z.number().min(0).max(1) }),
  z.object({ type: z.literal('blackout'), on: z.boolean() }),
]);
export type FromPage = z.infer<typeof FromPage>;

export type Control = { name: string, min: number, max: number, value: number, kind: 'macro' | 'bpm' };
export type PiState = {
  /** rev: its source's (below); offset, beat0 and paces: the prepared look's clocks, so a viewer renders the same
   * frame. */
  look: { id: string, rev: number, title: string, t: number, duration: number, bpm: number, beats: number,
    offset: number, beat0: number, paces: Record<string, number>, controls: Control[] } | null,
  /** The output's gain now: the master, blackout and a switch's dip, each as eased. */
  gain: number,
  level: number, blackout: boolean, tripped: { at: string, look: string } | null, switching: string | null,
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
