// Timeline edits as pure functions (SPEC "Timeline"): clips [{ start, end, fadeIn, fadeOut, transition? }], sorted,
// not overlapping. Each edit returns new arrays and keeps those rules, so the server accepts what the editor makes.
import { DEFAULT_DURATION, MAX_CLIPS, MAX_DURATION, MIN_DURATION } from '../core/timeline.ts';
import type { Clip } from '../../../shared/schemas/look.ts';
import type { Layer } from './model.ts';

export { DEFAULT_DURATION, MAX_DURATION };
const MAX_LAYERS = 8;
export const MIN_CLIP = 0.1;          // the shortest clip an edit makes
export const GRID = 0.25;             // snap step without a beat

/** Seconds to the millisecond, as the server keeps them. */
export const ms = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function cleanDuration(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? ms(clamp(n, MIN_DURATION, MAX_DURATION)) : DEFAULT_DURATION;
}

export function cleanBpm(v: unknown) {
  if (v === null || v === undefined || v === '') return null;
  const n = +v;
  return Number.isFinite(n) && n >= 40 && n <= 240 ? ms(n) : null;
}

export function snapStep(mode: string, bpm?: number | null) {
  if (mode === 'beat' && bpm) return 60 / bpm;
  return mode === 'off' ? 0 : GRID;
}

export const snap = (t: number, step: number) => (step > 0 ? Math.round(t / step) * step : t);

/** Every field, times to the ms. Fades that overrun a short clip stay: playback shrinks them (shownFades). */
export function fitClip(c: Clip): Clip {
  const fade = (v: number) => ms(clamp(+v || 0, 0, MAX_DURATION));
  const out: Clip = { start: ms(c.start), end: ms(c.end), fadeIn: fade(c.fadeIn), fadeOut: fade(c.fadeOut) };
  return c.transition ? { ...out, transition: c.transition } : out;
}

/** [fadeIn, fadeOut] as they play: shrunk in proportion when they overrun the clip. */
export function shownFades(c: Clip) {
  const len = c.end - c.start, sum = c.fadeIn + c.fadeOut;
  const k = sum > len && sum > 0 ? Math.max(0, len) / sum : 1;
  return [c.fadeIn * k, c.fadeOut * k];
}

/** Where clip i may go: between its neighbours, and not past `limit` unless it already reaches further. */
export function room(clips: Clip[], i: number, limit = MAX_DURATION) {
  const end = Math.min(MAX_DURATION, Math.max(limit, clips[i] ? clips[i].end : 0));
  return {
    lo: i > 0 ? clips[i - 1].end : 0,
    hi: i < clips.length - 1 ? Math.min(clips[i + 1].start, end) : end,
  };
}

const replace = (clips: Clip[], i: number, c: Clip) => clips.map((x, j) => (j === i ? fitClip(c) : x));

/** Move clip i near `start`, keeping its length, its neighbours and the grid (the nearer edge snaps). */
export function moveClip(clips: Clip[], i: number, start: number, step = 0, limit = MAX_DURATION) {
  const c = clips[i];
  const len = c.end - c.start;
  const { lo, hi } = room(clips, i, limit);
  let s = start;
  if (step > 0) {
    const a = snap(s, step), b = snap(s + len, step) - len;
    s = Math.abs(a - s) <= Math.abs(b - s) ? a : b;
  }
  s = clamp(s, lo, Math.max(lo, hi - len));
  return replace(clips, i, { ...c, start: s, end: s + len });
}

/** Drag clip i's 'start' or 'end' to t, between its neighbours, at least MIN_CLIP long. */
export function trimClip(clips: Clip[], i: number, edge: 'start' | 'end', t: number, step = 0,
  limit = MAX_DURATION) {
  const c = clips[i];
  const { lo, hi } = room(clips, i, limit);
  const v = snap(t, step);
  if (edge === 'start') return replace(clips, i, { ...c, start: clamp(v, lo, c.end - MIN_CLIP) });
  return replace(clips, i, { ...c, end: clamp(v, c.start + MIN_CLIP, hi) });
}

/** Clip i's fade 'in' or 'out' to `len` s, within what the other leaves. */
export function fadeClip(clips: Clip[], i: number, side: 'in' | 'out', len: number, step = 0) {
  const c = clips[i];
  const total = c.end - c.start;
  const v = Math.max(0, snap(len, step));
  const [fadeIn, fadeOut] = shownFades(c);
  if (side === 'in') return replace(clips, i, { ...c, fadeIn: Math.min(v, total - fadeOut), fadeOut });
  return replace(clips, i, { ...c, fadeIn, fadeOut: Math.min(v, total - fadeIn) });
}

/** Clip i from typed { start?, end?, fadeIn?, fadeOut? } within its room, or null; an edge past the other moves it. */
export function editClip(clips: Clip[], i: number, patch: Partial<Clip>, limit = MAX_DURATION) {
  const old = clips[i];
  const c = { ...old, ...patch };
  for (const k of ['start', 'end', 'fadeIn', 'fadeOut'] as const) if (!Number.isFinite(+c[k])) return null;
  const keep = { fadeIn: +c.fadeIn, fadeOut: +c.fadeOut, transition: c.transition };
  const both = patch.start !== undefined && patch.end !== undefined;
  let start = +c.start, end = +c.end;
  if (start >= end && !both) {
    const moved = moveClip(clips, i, patch.start !== undefined ? start : end - (old.end - old.start), 0, limit);
    return replace(moved, i, { ...moved[i], ...keep });
  }
  if (start === end) return null;
  if (start > end) [start, end] = [end, start];
  const { lo, hi } = room(clips, i, limit);
  start = clamp(start, lo, hi - MIN_CLIP);
  end = clamp(end, start + MIN_CLIP, hi);
  return replace(clips, i, { start, end, ...keep });
}

/** A clip of about `length` s at t, in the gap holding t (shifted left to fit) → { clips, index } | null. */
export function addClip(clips: Clip[] | undefined, t: number, length = 4, step = 0, limit = MAX_DURATION) {
  const list = clips || [];
  if (list.length >= MAX_CLIPS) return null;
  const at = Math.max(0, snap(t, step));
  if (at >= limit) return null;
  let i = 0;
  while (i < list.length && list[i].end <= at) i++;
  if (i < list.length && list[i].start <= at) return null;           // inside a clip
  const lo = i > 0 ? list[i - 1].end : 0;
  const hi = Math.min(i < list.length ? list[i].start : MAX_DURATION, limit);
  if (hi - lo < MIN_CLIP) return null;
  const len = Math.min(length, hi - lo);
  const start = Math.max(lo, Math.min(at, hi - len));
  const out = list.slice();
  out.splice(i, 0, fitClip({ start, end: start + len, fadeIn: 0, fadeOut: 0 }));
  return { clips: out, index: i };
}

export const removeClip = (clips: Clip[], i: number) => clips.filter((_, j) => j !== i);

/** When the look's content ends: the last clip, or `duration` while any layer is always on. */
export function contentEnd(layers: Pick<Layer, 'clips'>[], duration: number) {
  let end = 0;
  for (const l of layers) {
    if (!l.clips || !l.clips.length) end = Math.max(end, duration);
    else end = Math.max(end, l.clips[l.clips.length - 1].end);
  }
  return end;
}

/** Another look appended where this one's content ends → { layers, duration, start, end, ended } | { error }. */
export function importLook(layers: Layer[], duration: number, look: { layers?: Layer[]; duration?: number },
  newId: () => string) {
  const incoming = Array.isArray(look?.layers) ? look.layers : [];
  if (!incoming.length) return { error: 'That look has no layers.' };
  if (layers.length + incoming.length > MAX_LAYERS) {
    const counts = `this one has ${layers.length}, that one ${incoming.length}`;
    return { error: `A look holds at most ${MAX_LAYERS} layers: ${counts}.` };
  }
  const start = ms(contentEnd(layers, duration));
  const length = cleanDuration(look.duration);
  if (start + MIN_CLIP > MAX_DURATION) {
    return { error: `This look already fills ${MAX_DURATION} s, the longest a look runs.` };
  }
  const end = Math.min(MAX_DURATION, ms(start + length));
  let ended = 0;
  const kept = layers.map((l) => {
    if ((l.clips && l.clips.length) || start <= 0) return l;
    ended++;
    return { ...l, clips: [fitClip({ start: 0, end: start, fadeIn: 0, fadeOut: 0 })] };
  });
  const added = incoming.map((l) => {
    const own = Array.isArray(l.clips) && l.clips.length ? l.clips : [{ start: 0, end: length, fadeIn: 0, fadeOut: 0 }];
    const clips = own
      .map((c) => fitClip({ ...c, start: start + c.start, end: Math.min(end, start + c.end) }))
      .filter((c) => c.end - c.start >= MIN_CLIP)
      .slice(0, MAX_CLIPS);
    return { ...l, id: newId(), groups: [...(l.groups || [])], clips };
  });
  return { layers: [...kept, ...added], duration: Math.max(duration, end), start, end, ended };
}

/** A ruler step (s) keeping labels `minPx` apart at `pps`. */
export function rulerStep(pps: number, minPx = 56) {
  for (const s of [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (s * pps >= minPx) return s;
  return 600;
}

/** 75.5 → "1:15.5"; whole seconds drop the decimals. */
export function clock(t: number) {
  const m = Math.floor(t / 60), s = ms(t - m * 60);
  const whole = Math.floor(s), frac = ms(s - whole);
  return `${m}:${String(whole).padStart(2, '0')}${frac ? String(frac).slice(1, 4) : ''}`;
}

/** The transitions a clip can take (SPEC "Timeline"): a fade, or a wipe across one of these directions. */
export const WIPES = ['right', 'left', 'up', 'down', 'out', 'in'] as const;
/** Clip i with transition `kind` ('fade' or 'wipe:<direction>'). */
export function setTransition(clips: Clip[], i: number, kind: string) {
  const [, dir] = kind.split(':'), { transition: _, ...c } = clips[i];
  const direction = WIPES.find((d) => d === dir);
  return replace(clips, i, direction ? { ...c, transition: { kind: 'wipe', direction } } : c);
}
/** A clip's transition as setTransition names it. */
export const transitionKey = (c: Clip) => (c.transition?.kind === 'wipe' ? `wipe:${c.transition.direction ?? 'right'}`
  : 'fade');
