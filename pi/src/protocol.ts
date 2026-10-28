// The control page's socket (pi/README.md "The control page"): what the page (and Studio's feed) may send, checked
// here, and the state the Pi sends back about ten times a second. Shared by the server and the page.
import { z } from 'zod';

import type { PiSource } from '../../shared/schemas/live.ts';
import type { RelayState } from './relay.ts';
import { Pick } from '../../shared/schemas/look.ts';
import type { PaletteHex } from '../../public/js/core/stdlib.ts';

export const ColourValue = z.union([Pick, z.tuple([z.number().min(0).max(1),
  z.number().min(0).max(1), z.number().min(0).max(1)])]);
// Saved colours also accept the core's legacy strings and RGB arrays; incoming edits use ColourValue above.
export type SavedColour = z.infer<typeof Pick> | number[];
export type SettingValue = number | SavedColour;

export const At = z.enum(['now', 'next', 'end']);
/** Seconds the playing look fades out over, and the next in (SPEC-liveplay "Messages"). */
export const Fade = z.number().min(0.25).max(8);
export const MODES = ['jukebox', 'live'] as const;
export type Mode = (typeof MODES)[number];

export const FromPage = z.discriminatedUnion('type', [
  /** who: set by Studio's proxy from the session (a page's own is dropped there); none on the Pi's own page. */
  z.object({ type: z.literal('hello'), pin: z.string().max(32).optional(), feed: z.boolean().optional(),
    who: z.object({ name: z.string().min(1).max(64), drive: z.boolean() }).optional() }),
  z.object({ type: z.literal('play'), id: z.string().max(64), fade: Fade.optional() }),
  z.object({ type: z.literal('set'), name: z.string().max(256),
    value: z.union([z.number().finite(), z.string().max(256), ColourValue]) }),
  z.object({ type: z.literal('release'), name: z.string().max(256) }),
  z.object({ type: z.literal('palette'), name: z.string().max(64) }),
  /** A tap at the page's clock (ms): the tempo comes from the page's spacing, free of the network's jitter. */
  z.object({ type: z.literal('tap'), at: z.number().finite() }),
  z.object({ type: z.literal('level'), value: z.number().min(0).max(1) }),
  z.object({ type: z.literal('blackout'), on: z.boolean() }),
  z.object({ type: z.literal('take') }),
  /** The relay lease (SPEC-live "Relay to the lights"): its frames are binary messages. */
  z.object({ type: z.literal('relay-start'), over: z.boolean().optional() }),
  z.object({ type: z.literal('relay-stop') }),
  // The queue (SPEC-offline "Playing on the lights"): one of the engine's own looks, a look Studio sent, and moves.
  z.object({ type: z.literal('queue'), id: z.string().max(64), at: At.optional(), fade: Fade.optional() }),
  z.object({ type: z.literal('unqueue'), key: z.string().max(16) }),
  z.object({ type: z.literal('move'), key: z.string().max(16), to: z.number().int().min(0).max(64) }),
  z.object({ type: z.literal('next'), fade: Fade.optional() }),
  /** From Studio's feed only: the mode the admin set. */
  z.object({ type: z.literal('mode'), mode: z.enum(MODES) }),
  /** From Studio's feed only: a library-only look (modules by ref), resolved against the engine's library. */
  z.object({ type: z.literal('send'), requestId: z.string().min(1).max(64).optional(),
    at: At.optional(), fade: Fade.optional(), by: z.string().max(64).optional(),
    item: z.discriminatedUnion('kind', [z.object({ kind: z.literal('live'), look: z.looseObject({}) }),
      // A bake by its look's id, read from Studio's frames (pi/src/baked.ts) and held to this SHA-256.
      z.object({ kind: z.literal('baked'), id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), title: z.string().max(200),
        sha256: z.string().regex(/^[0-9a-f]{64}$/), duration: z.number().positive().max(86400).optional() })]) }),
]);
/** The most a `send` may be; every other message is held to 1 KB. */
export const MAX_SEND = 64 * 1024;
export type FromPage = z.infer<typeof FromPage>;
/** Messages reserved for Studio's feed; never passed through from a browser page. */
export const STUDIO_MESSAGES: ReadonlySet<FromPage['type']> = new Set(['send', 'mode']);
/** Controls that make the Pi page drive Studio's stage. */
export const STAGE_CONTROLS: ReadonlySet<FromPage['type']> = new Set([
  'play', 'set', 'release', 'palette', 'tap', 'level', 'blackout', 'next',
]);
export const JUKEBOX_NOW = 'The lights are in Jukebox: Play next or Add to the end';

/** default: the look's own value; held: a person moved it since the look began and has not let it go. A palette's
 * value is a name ('': the look's own, not one of data/palettes.json's). */
export type Control = { name: string, min: number, max: number, default: number, value: number, held: boolean,
  kind: 'macro' | 'bpm' } | { name: 'palette', min: 0, max: 0, value: string, default: string, held: boolean,
  kind: 'palette' } | { name: string, label: string, setting: string, held: boolean, kind: 'choice',
    value: string, default: string, options: string[] } | { name: string, label: string, setting: string, held: boolean,
    kind: 'color', value: SavedColour, default: SavedColour, palette: PaletteHex };
/** duration: seconds of what it plays (a bake not read yet: null). */
export type QueueItem = { key: string, id: string, title: string, kind: 'look' | 'live' | 'baked', by?: string,
  duration: number | null };
export type PiState = {
  /** rev: its source's (below); offset, beat0 and paces: the prepared look's clocks, so a viewer renders the same
   * frame. */
  /** kind: where it came from (QueueItem); left: seconds of its pattern to play, null while nothing is queued. */
  look: { id: string, rev: number, title: string, kind: QueueItem['kind'], t: number, duration: number,
    left: number | null, bpm: number, beats: number,
    offset: number, beat0: number, paces: Record<string, number>, controls: Control[] } | null,
  /** The output's gain now: the master, blackout and a switch's dip, each as eased. */
  gain: number,
  /** blackout: on, who turned it on or off last (null: no one yet, or the engine), seconds ago. */
  level: number, blackout: { on: boolean, by: string | null, ago: number },
  tripped: { at: string, look: string } | null,
  /** The mode; who has the knobs (ago: seconds since they last moved one); who has a page open. */
  mode: Mode, driver: { name: string, ago: number } | null, here: string[],
  /** paused: the flash guard tripped, and the queue waits for a person. */
  paused: boolean, switching: { id: string, title: string } | null, queue: QueueItem[],
  /** The engine's own looks; duration: seconds of a play. */
  looks: { id: string, title: string, playable: boolean, error?: string, duration: number }[],
  out: { dryRun: boolean, fps: number, renderMs: number, genW: number, genPeakW: number, gen: number, cut: number,
    ddpErrors: number, lastError: string },
  /** Who relays frames to the lights, and how it goes (null: no one). */
  relay: RelayState | null,
};
/** The state as the engine has it; the server adds who and the mode. */
export type EngineState = Omit<PiState, 'mode' | 'driver' | 'here'>;
export type ToPage =
  | { type: 'sent', requestId: string, ok: boolean, error?: string }
  /** you: who this page is, as the engine has it (none for Studio's feed). */
  | { type: 'hello', ok: boolean, needPin: boolean, error?: string, you?: { name: string, drive: boolean } }
  | { type: 'state', state: PiState }
  /** What plays (layers by ref, no code), on hello and at each change: for Studio's Live tab following /pi. */
  | { type: 'source', source: PiSource }
  /** Behind Studio's proxy only: who drives its Live tab, this page or Live control. */
  | { type: 'driver', from: 'pi' | 'live' }
  /** The relay lease: this socket holds it or not, and why not. */
  | { type: 'relay', holding: boolean, error?: string }
  | { type: 'error', error: string };
