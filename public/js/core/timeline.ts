// The timeline (SPEC "Timeline"): a look lasts `duration` seconds; a layer with clips is lit only inside them.
import type { Clip } from '../../../shared/schemas/look.ts';
import { clamp, type Direction, DIRECTIONS, isNum, OLD_DIRECTIONS, toward } from './stdlib.ts';

export const DEFAULT_DURATION = 30;
export const MIN_DURATION = 1;
export const MAX_DURATION = 600;
export const MAX_CLIPS = 32;

/** A look's length in seconds: `look.duration` held to 1..600, else 30. */
export function lookDuration(look?: { duration?: unknown } | null) {
  const d = look?.duration;
  return isNum(d) ? clamp(d, MIN_DURATION, MAX_DURATION) : DEFAULT_DURATION;
}

export const TRANSITIONS = Object.freeze(['fade', 'wipe'] as const);
export type Transition = { kind: (typeof TRANSITIONS)[number], direction: Direction, softness: number };

/** A clip's transition as the renderer uses it, or null for a plain fade (anything unknown fades). */
function normalizeTransition(v: unknown): Transition | null {
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : null;
  if (o?.kind !== 'wipe') return null;
  const known = [...DIRECTIONS, ...OLD_DIRECTIONS] as readonly unknown[];
  const direction = known.includes(o.direction) ? o.direction as Direction : 'right';
  return { kind: 'wipe', direction, softness: isNum(o.softness) ? clamp(o.softness, 0.001, 1) : 0.1 };
}

/**
 * A pixel's share of its layer at clip envelope e (0..1): `fade` all of it, e (the level carries it); `wipe` 1 once
 * the edge, rising with e across `direction` (`toward(p, direction)`), has passed it, over `softness`. Going `out`
 * the wipe carries on across, so the first pixels lit go first. Pure, no allocation: the live stage uses it too.
 */
export function transitionWeight(kind: string, direction: string, e: number, p: Parameters<typeof toward>[0],
  out = false, softness = 0.1) {
  if (kind !== 'wipe' || !(e < 1)) return 1;
  const s = softness > 0.001 ? softness : 0.001, x = toward(p, direction);
  return clamp((e * (1 + s) - (out ? 1 - x : x)) / s);
}

const at = { lx: 0, ly: 0, lz: 0, a: 0, r: 0, u: 0, sector: -1, ring: 0 };
type Num = ArrayLike<number>;
type Placed = { idx: Int32Array, lx: Num, ly: Num, lz: Num, a: Num, r: Num };
/** A wipe on a layer's colours (rgba, the layer's pixels in order; S: the scene's u, sector and ring) at envelope
 * e: each alpha × its transitionWeight. No allocation. */
export function wipeColours(buf: Float64Array, L: Placed, S: { u: Num, sector: Num, ring: Num }, w: Transition,
  e: number, out: boolean) {
  for (let j = 0; j < L.idx.length; j++) {
    const k = L.idx[j]!;
    at.lx = L.lx[j]!; at.ly = L.ly[j]!; at.lz = L.lz[j]!; at.a = L.a[j]!; at.r = L.r[j]!;
    at.u = S.u[k]!; at.sector = S.sector[k]!; at.ring = S.ring[k]!;
    buf[4 * j + 3]! *= transitionWeight('wipe', w.direction, e, at, out, w.softness);
  }
}

/**
 * Clips as the renderer uses them: [{ start, end, fadeIn, fadeOut, transition? (a wipe's) }], finite, end > start,
 * fades ≥ 0, sorted, at most MAX_CLIPS, overlapping ones dropped; null when there are none (the layer is always on).
 */
export function normalizeClips(clips: unknown): Clip[] | null {
  if (!Array.isArray(clips) || !clips.length) return null;
  const list: Clip[] = [];
  for (const c of clips) {
    if (!c || typeof c !== 'object') continue;
    const start = +c.start, end = +c.end;
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) continue;
    const fadeIn = +c.fadeIn > 0 && Number.isFinite(+c.fadeIn) ? +c.fadeIn : 0;
    const fadeOut = +c.fadeOut > 0 && Number.isFinite(+c.fadeOut) ? +c.fadeOut : 0;
    const transition = normalizeTransition(c.transition);
    list.push(transition ? { start, end, fadeIn, fadeOut, transition } : { start, end, fadeIn, fadeOut });
  }
  list.sort((a, b) => a.start - b.start);
  const out: Clip[] = [];
  for (const c of list) {
    if (out.length >= MAX_CLIPS) break;
    if (out.length && c.start < out.at(-1)!.end) continue;
    out.push(c);
  }
  return out.length ? out : null;
}

/**
 * How much of clip c shows at t in [start, end) (0..1): a linear ramp up over fadeIn and down over fadeOut (shrunk
 * in proportion when they overrun the clip); negative while fading out, so a wipe knows its phase. No allocation.
 */
export function clipFade(c: Clip, t: number) {
  let fi = c.fadeIn > 0 ? c.fadeIn : 0, fo = c.fadeOut > 0 ? c.fadeOut : 0;
  const len = c.end - c.start;
  if (fi + fo > len) { const k = len / (fi + fo); fi *= k; fo *= k; }
  if (fo > 0 && t > c.end - fo) return -(c.end - t) / fo;
  return fi > 0 && t < c.start + fi ? (t - c.start) / fi : 1;
}

/** How much of a layer shows at t (0..1): 1 with no clips; its clip's fade (clipFade) in one; 0 outside. */
export function layerEnvelope(clips: readonly Clip[] | null | undefined, t: number) {
  if (!clips || !clips.length) return 1;
  const c = clipAt(clips, t);
  return c ? Math.abs(clipFade(c, t)) : 0;
}

/** The clip lit at t, or null (clips never overlap). */
export function clipAt(clips: readonly Clip[] | null | undefined, t: number) {
  if (clips) for (let i = 0; i < clips.length; i++) if (t >= clips[i].start && t < clips[i].end) return clips[i];
  return null;
}
