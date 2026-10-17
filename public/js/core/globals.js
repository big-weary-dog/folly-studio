// The look's globals (SPEC "Globals"): speed (an accumulated clock), master level, hue and saturation applied to
// the composite, energy, the palette and macros, as G; automation lanes evaluated per frame.
import { DEFAULT_PALETTE, paletteColours, RUN } from './palette.js';
import { clamp, isNum, TAU } from './stdlib.js';

/** The built-in globals: default value and range. */
export const GLOBALS = Object.freeze({
  speed: Object.freeze({ value: 1, min: 0, max: 4 }),
  level: Object.freeze({ value: 1, min: 0, max: 1 }),
  hue: Object.freeze({ value: 0, min: -0.5, max: 0.5 }),
  saturation: Object.freeze({ value: 1, min: 0, max: 2 }),
  energy: Object.freeze({ value: 0.5, min: 0, max: 1 }),
});
export const MAX_MACROS = 16;
export const MAX_LANES = 16;
export const MAX_POINTS = 256;
const MACRO_NAME = /^[a-z][A-Za-z0-9_]{0,31}$/;
/** May `name` be a macro? Not one of G's own names, nor anything every object has. */
export const macroNameOk = (name) => typeof name === 'string' && MACRO_NAME.test(name) && !(name in GLOBALS)
  && name !== 'palette' && !(name in Object.prototype);

/** Lenient: { speed, level, hue, saturation, energy, palette, macros: [{ name, value, min, max }] }. */
export function normalizeGlobals(g) {
  const src = g && typeof g === 'object' ? g : {};
  const out = {};
  for (const [k, d] of Object.entries(GLOBALS)) out[k] = isNum(src[k]) ? clamp(src[k], d.min, d.max) : d.value;
  out.palette = src.palette && typeof src.palette === 'object' ? src.palette : DEFAULT_PALETTE;
  out.macros = [];
  const macros = src.macros && typeof src.macros === 'object' ? src.macros : {};
  for (const [name, m] of Object.entries(macros)) {
    if (out.macros.length >= MAX_MACROS || !macroNameOk(name) || !m || typeof m !== 'object') continue;
    const min = isNum(m.min) ? m.min : 0, max = isNum(m.max) && m.max > min ? m.max : min + 1;
    out.macros.push({ name, min, max, value: isNum(m.value) ? clamp(m.value, min, max) : min });
  }
  return out;
}

/** A lane's value at t: linear between [t, v] points (ascending t), held before the first and after the last. */
export function automationAt(points, t) {
  const n = points ? points.length : 0;
  if (!n) return NaN;
  if (!(t > points[0][0])) return points[0][1];
  if (t >= points[n - 1][0]) return points[n - 1][1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid][0] <= t) lo = mid; else hi = mid; }
  const a = points[lo], b = points[hi];
  return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
}

/** ∫ from 0 to t of a lane (exact: it is piecewise linear). */
function integral(points, t) {
  if (!(t > 0)) return 0;
  let sum = 0, a = 0, fa = automationAt(points, 0);
  for (let i = 0; i < points.length; i++) {
    const b = points[i][0];
    if (b <= a) continue;
    if (b >= t) break;
    sum += (fa + points[i][1]) * (b - a) / 2;
    a = b; fa = points[i][1];
  }
  return sum + (fa + automationAt(points, t)) * (t - a) / 2;
}

/** Lanes the runtime can play: known names, finite points sorted by time (ties dropped), values in range. */
function lanesOf(automation, g) {
  const lanes = [];
  const src = automation && typeof automation === 'object' ? automation : {};
  for (const [name, pts] of Object.entries(src)) {
    const range = GLOBALS[name] || g.macros.find((m) => m.name === name);
    if (lanes.length >= MAX_LANES || !range || !Array.isArray(pts)) continue;
    const points = pts.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1])).slice(0, MAX_POINTS)
      .map((p) => Object.freeze([p[0], clamp(p[1], range.min, range.max)])).sort((a, b) => a[0] - b[0])
      .filter((p, i, all) => i === 0 || p[0] > all[i - 1][0]);
    if (points.length) lanes.push({ name, points: Object.freeze(points), min: range.min, max: range.max });
  }
  return lanes;
}

/**
 * A look's globals and automation, ready for renderFrame: { G, bpm, T (pattern time), norm(name) → 0..1, … }.
 * `previous` (the look this one replaces, live) keeps the clock continuous where it last played.
 */
export function prepareLook(look, previous) {
  const g = normalizeGlobals(look && look.globals);
  const lanes = lanesOf(look && look.automation, g);
  const G = { energy: g.energy, speed: g.speed, level: g.level, hue: g.hue, saturation: g.saturation,
    palette: paletteColours(g.palette) || paletteColours(DEFAULT_PALETTE) };
  for (const m of g.macros) G[m.name] = m.value;
  Object.seal(G);
  const ranges = new Map([...Object.entries(GLOBALS), ...g.macros.map((m) => [m.name, m])]);
  const L = {
    G, g, lanes, bpm: isNum(look && look.bpm) && look.bpm > 0 ? look.bpm : 120, palette: G.palette,
    speedLane: lanes.find((l) => l.name === 'speed')?.points || null, offset: 0, lastT: NaN, T: 0,
    grade: new Float64Array(9), graded: false, key: '',
    norm(name) {
      const r = ranges.get(name);
      return r ? clamp((G[name] - r.min) / (r.max - r.min)) : 0;
    },
  };
  if (previous && Number.isFinite(previous.lastT)) {
    L.offset = clockAt(previous, previous.lastT) - clockAt(L, previous.lastT);
    L.lastT = previous.lastT;
  }
  return L;
}

/** Pattern time at show time t: ∫ speed dt (plus the offset that kept it continuous). */
function clockAt(L, t) {
  const base = L.speedLane ? integral(L.speedLane, t) : L.g.speed === 1 ? t : L.g.speed * t;
  return L.offset + base;
}

/** Set up frame t: G's values (statics, then automation), the clock, the grade, and RUN. No allocation. */
export function lookFrame(L, t) {
  if (t < L.lastT) L.offset = 0;      // looped, restarted or sought back: back on the canonical clock
  L.lastT = t;
  const G = L.G, g = L.g;
  G.energy = g.energy; G.speed = g.speed; G.level = g.level; G.hue = g.hue; G.saturation = g.saturation;
  G.palette = L.palette;
  for (let i = 0; i < g.macros.length; i++) G[g.macros[i].name] = g.macros[i].value;
  for (let i = 0; i < L.lanes.length; i++) G[L.lanes[i].name] = automationAt(L.lanes[i].points, t);
  L.T = clockAt(L, t);
  setGrade(L, G.level, G.hue, G.saturation);
  RUN.G = G;
  RUN.palette = L.palette;
}

const LUMA = [0.2126, 0.7152, 0.0722];
const H = new Float64Array(9);
/** level × saturation × hue rotation (round the grey axis) as one 3×3 matrix; identity skips it. */
function setGrade(L, level, hue, sat) {
  L.graded = !(level === 1 && hue === 0 && sat === 1);
  if (!L.graded || (L.level === level && L.hue === hue && L.sat === sat)) return;
  L.level = level; L.hue = hue; L.sat = sat;
  const c = Math.cos(hue * TAU), s = Math.sin(hue * TAU) / Math.sqrt(3), k = (1 - c) / 3;
  H[0] = H[4] = H[8] = c + k;
  H[1] = H[5] = H[6] = k - s;
  H[2] = H[3] = H[7] = k + s;
  const M = L.grade;
  for (let r = 0; r < 3; r++) {
    for (let col = 0; col < 3; col++) {
      let v = 0;
      for (let i = 0; i < 3; i++) v += ((r === i ? sat : 0) + (1 - sat) * LUMA[i]) * H[3 * i + col];
      M[3 * r + col] = level * v;
    }
  }
}

const cl = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
/** The composite, clamped, graded (when the look asks) and clamped again. */
export function finish(rgb, n, L) {
  if (!L || !L.graded) {
    for (let i = 0; i < n; i++) { const v = rgb[i]; if (!(v > 0)) rgb[i] = 0; else if (v > 1) rgb[i] = 1; }
    return;
  }
  const M = L.grade;
  for (let i = 0; i < n; i += 3) {
    const r = cl(rgb[i]), g = cl(rgb[i + 1]), b = cl(rgb[i + 2]);
    rgb[i] = cl(M[0] * r + M[1] * g + M[2] * b);
    rgb[i + 1] = cl(M[3] * r + M[4] * g + M[5] * b);
    rgb[i + 2] = cl(M[6] * r + M[7] * g + M[8] * b);
  }
}
