// The timeline (SPEC "Timeline"): a look lasts `duration` seconds; a layer with clips is lit only inside them.
import type { Clip } from '../../../shared/schemas/look.ts';
import { clamp, isNum } from './stdlib.ts';

export const DEFAULT_DURATION = 30;
export const MIN_DURATION = 1;
export const MAX_DURATION = 600;
export const MAX_CLIPS = 32;

/** A look's length in seconds: `look.duration` held to 1..600, else 30. */
export function lookDuration(look?: { duration?: unknown } | null) {
  const d = look?.duration;
  return isNum(d) ? clamp(d, MIN_DURATION, MAX_DURATION) : DEFAULT_DURATION;
}

/**
 * Clips as the renderer uses them: [{ start, end, fadeIn, fadeOut }], finite, end > start, fades ≥ 0, sorted,
 * at most MAX_CLIPS, overlapping ones dropped; null when there are none (the layer is always on).
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
    list.push({ start, end, fadeIn, fadeOut });
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
 * How much of a layer shows at t (0..1): 1 with no clips; in a clip [start, end) a linear ramp up over
 * fadeIn and down over fadeOut (shrunk in proportion when they overrun the clip); 0 outside. No allocation.
 */
export function layerEnvelope(clips: readonly Clip[] | null | undefined, t: number) {
  if (!clips || !clips.length) return 1;
  let best = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const start = c.start, end = c.end;
    if (!(t >= start && t < end)) continue;
    let fi = c.fadeIn > 0 ? c.fadeIn : 0, fo = c.fadeOut > 0 ? c.fadeOut : 0;
    const len = end - start;
    if (fi + fo > len) { const k = len / (fi + fo); fi *= k; fo *= k; }
    let v = 1;
    if (fi > 0 && t < start + fi) v = (t - start) / fi;
    if (fo > 0 && t > end - fo) { const w = (end - t) / fo; if (w < v) v = w; }
    if (v > best) best = v;
  }
  return best;
}
