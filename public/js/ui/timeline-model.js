// Timeline edits as pure functions (SPEC "Timeline"): clips [{ start, end, fadeIn, fadeOut }] in seconds, sorted,
// not overlapping. Each edit returns new arrays and keeps those rules, so the server accepts what the editor makes.
import { DEFAULT_DURATION, MAX_CLIPS, MAX_DURATION, MIN_DURATION } from '../core/timeline.js';

export { DEFAULT_DURATION, MAX_DURATION };
const MAX_LAYERS = 8;
export const MIN_CLIP = 0.1;          // the shortest clip an edit makes
export const GRID = 0.25;             // snap step without a beat

/** Seconds to the millisecond, as the server keeps them. */
export const ms = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function cleanDuration(v) {
  const n = +v;
  return Number.isFinite(n) && n > 0 ? ms(clamp(n, MIN_DURATION, MAX_DURATION)) : DEFAULT_DURATION;
}

export function cleanBpm(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = +v;
  return Number.isFinite(n) && n >= 40 && n <= 240 ? ms(n) : null;
}

export function snapStep(mode, bpm) {
  if (mode === 'beat' && bpm) return 60 / bpm;
  return mode === 'off' ? 0 : GRID;
}

export const snap = (t, step) => (step > 0 ? Math.round(t / step) * step : t);

/** Every field, to the ms. Fades that overrun a short clip stay: playback shrinks them (shownFades). */
export function fitClip(c) {
  const fade = (v) => ms(clamp(+v || 0, 0, MAX_DURATION));
  return { start: ms(c.start), end: ms(c.end), fadeIn: fade(c.fadeIn), fadeOut: fade(c.fadeOut) };
}

/** [fadeIn, fadeOut] as they play: shrunk in proportion when they overrun the clip. */
export function shownFades(c) {
  const len = c.end - c.start, sum = c.fadeIn + c.fadeOut;
  const k = sum > len && sum > 0 ? Math.max(0, len) / sum : 1;
  return [c.fadeIn * k, c.fadeOut * k];
}

/** Where clip i may go: between its neighbours, and not past `limit` unless it already reaches further. */
export function room(clips, i, limit = MAX_DURATION) {
  const end = Math.min(MAX_DURATION, Math.max(limit, clips[i] ? clips[i].end : 0));
  return {
    lo: i > 0 ? clips[i - 1].end : 0,
    hi: i < clips.length - 1 ? Math.min(clips[i + 1].start, end) : end,
  };
}

const replace = (clips, i, c) => clips.map((x, j) => (j === i ? fitClip(c) : x));

/** Move clip i near `start`, keeping its length, its neighbours and the grid (the nearer edge snaps). */
export function moveClip(clips, i, start, step = 0, limit = MAX_DURATION) {
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
export function trimClip(clips, i, edge, t, step = 0, limit = MAX_DURATION) {
  const c = clips[i];
  const { lo, hi } = room(clips, i, limit);
  const v = snap(t, step);
  if (edge === 'start') return replace(clips, i, { ...c, start: clamp(v, lo, c.end - MIN_CLIP) });
  return replace(clips, i, { ...c, end: clamp(v, c.start + MIN_CLIP, hi) });
}

/** Clip i's fade 'in' or 'out' to `len` s, within what the other leaves. */
export function fadeClip(clips, i, side, len, step = 0) {
  const c = clips[i];
  const total = c.end - c.start;
  const v = Math.max(0, snap(len, step));
  const [fadeIn, fadeOut] = shownFades(c);
  if (side === 'in') return replace(clips, i, { ...c, fadeIn: Math.min(v, total - fadeOut), fadeOut });
  return replace(clips, i, { ...c, fadeIn, fadeOut: Math.min(v, total - fadeIn) });
}

/** Clip i from typed { start?, end?, fadeIn?, fadeOut? } within its room, or null; an edge past the other moves it. */
export function editClip(clips, i, patch, limit = MAX_DURATION) {
  const old = clips[i];
  const c = { ...old, ...patch };
  for (const k of ['start', 'end', 'fadeIn', 'fadeOut']) if (!Number.isFinite(+c[k])) return null;
  const keep = { fadeIn: +c.fadeIn, fadeOut: +c.fadeOut };
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
export function addClip(clips, t, length = 4, step = 0, limit = MAX_DURATION) {
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

export const removeClip = (clips, i) => clips.filter((_, j) => j !== i);

/** When the look's content ends: the last clip, or `duration` while any layer is always on. */
export function contentEnd(layers, duration) {
  let end = 0;
  for (const l of layers) {
    if (!l.clips || !l.clips.length) end = Math.max(end, duration);
    else end = Math.max(end, l.clips[l.clips.length - 1].end);
  }
  return end;
}

/** Another look appended where this one's content ends → { layers, duration, start, end, ended } | { error }. */
export function importLook(layers, duration, look, newId) {
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
    const own = Array.isArray(l.clips) && l.clips.length ? l.clips : [{ start: 0, end: length }];
    const clips = own
      .map((c) => fitClip({ ...c, start: start + c.start, end: Math.min(end, start + c.end) }))
      .filter((c) => c.end - c.start >= MIN_CLIP)
      .slice(0, MAX_CLIPS);
    return { ...l, id: newId(), groups: [...(l.groups || [])], params: { ...(l.params || {}) }, clips };
  });
  return { layers: [...kept, ...added], duration: Math.max(duration, end), start, end, ended };
}

/** A ruler step (s) keeping labels `minPx` apart at `pps`. */
export function rulerStep(pps, minPx = 56) {
  for (const s of [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (s * pps >= minPx) return s;
  return 600;
}

/** 75.5 → "1:15.5"; whole seconds drop the decimals. */
export function clock(t) {
  const m = Math.floor(t / 60), s = ms(t - m * 60);
  const whole = Math.floor(s), frac = ms(s - whole);
  return `${m}:${String(whole).padStart(2, '0')}${frac ? String(frac).slice(1, 4) : ''}`;
}
