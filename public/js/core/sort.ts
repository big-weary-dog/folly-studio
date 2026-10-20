// The sort op (SPEC "Spatial modules"): along each strand, every run of LEDs at least a cutoff bright has its colours
// sorted, so the bright (or the hues in order) gather toward one end, a glitch-art pixel sort. Over a layer's stage
// buffer, between its stages; scratch grows with the layer and nothing is allocated per frame after.
import type { Scene } from './scene.ts';

export const SORT_BY = Object.freeze(['brightness', 'colour'] as const);
export const SORT_TOWARD = Object.freeze(['up', 'down', 'start', 'end'] as const);
// A key in 2^-16 steps, then a place in the run (< 2^23): one sortable number, exact in a double, ties by place.
const RANK = 2 ** 16, PLACES = 2 ** 23;
let keys = new Float64Array(0), spots = new Float64Array(0), tmp = new Float64Array(0);

/** Luminance by alpha of buf's pixel j (straight rgba), 0..1. */
function luma(buf: Float64Array, j: number) {
  const o = 4 * j, v = (0.2126 * buf[o] + 0.7152 * buf[o + 1] + 0.0722 * buf[o + 2]) * buf[o + 3];
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Hue 0..1 of buf's pixel j (grey 0). */
function hue(buf: Float64Array, j: number) {
  const o = 4 * j, r = buf[o], g = buf[o + 1], b = buf[o + 2], hi = Math.max(r, g, b), d = hi - Math.min(r, g, b);
  if (!(d > 0)) return 0;
  const h = hi === r ? (g - b) / d : hi === g ? 2 + (b - r) / d : 4 + (r - g) / d;
  return (h < 0 ? h + 6 : h) / 6;
}

/** Sorts a[0..n) ascending, in place (runs are short and often nearly sorted). */
function sortUp(a: Float64Array, n: number) {
  for (let i = 1; i < n; i++) {
    const v = a[i];
    let j = i - 1;
    while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j--; }
    a[j + 1] = v;
  }
}

/** Pixels j0..j1 of the layer (one run): the n-th dimmest colour moves to the n-th place nearest where it ends. */
function sortRun(S: Scene, idx: Int32Array, buf: Float64Array, j0: number, j1: number, hues: boolean, to: string) {
  const n = j1 - j0;
  for (let t = 0; t < n; t++) {
    const v = hues ? hue(buf, j0 + t) : luma(buf, j0 + t);
    keys[t] = Math.round(v * RANK) * PLACES + t;
  }
  sortUp(keys, n);
  const byY = to === 'up' || to === 'down', down = to === 'down' ? -1 : 1;
  if (byY) {                                // places by height, millimetres from 1 km below
    for (let t = 0; t < n; t++) spots[t] = Math.round((1000 + down * S.Y[idx[j0 + t]]) * 1000) * PLACES + t;
    sortUp(spots, n);
  }
  for (let r = 0; r < n; r++) {
    const from = 4 * (j0 + keys[r] % PLACES);
    const at = byY ? spots[r] % PLACES : to === 'start' ? n - 1 - r : r, o = 4 * (j0 + at);
    for (let i = 0; i < 4; i++) tmp[o + i] = buf[from + i];
  }
}

/**
 * Sorts a layer's colours (buf: rgba per pixel of idx, straight alpha) in place: along each fixture, each run of
 * consecutive LEDs at least `cutoff` bright (darker ones stay and break the runs; 0: whole strands) by `by`
 * (brightness, or hue by colour), the brightest (or last hue) toward `toward` (up, down, the wire's start or end),
 * mixed with the unsorted by amount.
 */
export function sortStrands(S: Scene, idx: Int32Array, buf: Float64Array, by: unknown, toward: unknown,
  cutoff: unknown, amount: unknown) {
  const a0 = amount === undefined ? 1 : Number(amount), mix = a0 > 1 ? 1 : a0, m = idx.length;
  if (!(mix > 0) || m < 2) return;
  const lo = Number(cutoff) > 0 ? Number(cutoff) : 0, hues = by === 'colour';
  const to = SORT_TOWARD.includes(toward as never) ? toward as string : 'up', F = S.fixture;
  if (tmp.length < 4 * m) { keys = new Float64Array(m); spots = new Float64Array(m); tmp = new Float64Array(4 * m); }
  for (let j = 0; j < m;) {
    if (luma(buf, j) < lo) { j++; continue; }
    let e = j + 1;
    while (e < m && idx[e] === idx[e - 1] + 1 && F[idx[e]] === F[idx[j]] && luma(buf, e) >= lo) e++;
    if (e - j > 1) {
      sortRun(S, idx, buf, j, e, hues, to);
      for (let i = 4 * j; i < 4 * e; i++) buf[i] += (tmp[i] - buf[i]) * mix;
    }
    j = e;
  }
}
