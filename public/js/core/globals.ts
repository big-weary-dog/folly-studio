// The look's globals as G (SPEC "Globals"): speed (a clock), level, hue and saturation (the composite's grade),
// energy, palette, macros; automation per frame; param values and bindings (SPEC "Param bindings").
import type { Automation, Binding, Globals, Range } from '../../../shared/schemas/look.ts';
import type { ParamSchema } from './compile.ts';
import { clamp, DEFAULT_PALETTE, hex, isNum, paletteColours, RUN, TAU } from './stdlib.ts';
import type { PaletteColours, PaletteHex } from './stdlib.ts';

/** G: the look's globals as patterns see them, its macros by name (SPEC "Globals"). */
export type G = { energy: number, speed: number, level: number, hue: number, saturation: number,
  palette: PaletteColours, [macro: string]: number | PaletteColours };
/** P: a module's param values (colours as [r, g, b], choices as their name). */
export type Values = Record<string, number | boolean | number[] | string>;
type Points = readonly (readonly number[])[];

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
/** May `name` be a macro: not one of G's own, nor anything every object has? */
export const macroNameOk = (name: unknown): name is string => typeof name === 'string' && MACRO_NAME.test(name)
  && !(name in GLOBALS) && name !== 'palette' && !(name in Object.prototype);

/** Lenient: each global in range, a palette, macros: [{ name, value, min, max }]. */
export function normalizeGlobals(g?: Globals | null) {
  const src: Record<string, unknown> & Globals = g && typeof g === 'object' ? g : {};
  const out = Object.fromEntries(Object.entries(GLOBALS).map(([k, d]) => [k, isNum(src[k]) ? clamp(src[k], d.min, d.max)
    : d.value])) as Record<keyof typeof GLOBALS, number>;
  const palette: PaletteHex = src.palette && typeof src.palette === 'object' ? src.palette : DEFAULT_PALETTE;
  const macros: (Range & { name: string, value: number })[] = [];
  for (const [name, m] of Object.entries(src.macros && typeof src.macros === 'object' ? src.macros : {})) {
    if (macros.length >= MAX_MACROS || !macroNameOk(name) || !m || typeof m !== 'object') continue;
    const min = isNum(m.min) ? m.min : 0, max = isNum(m.max) && m.max > min ? m.max : min + 1;
    macros.push({ name, min, max, value: isNum(m.value) ? clamp(m.value, min, max) : min });
  }
  return { ...out, palette, macros };
}

/** A lane's value at t: linear between [t, v] points, held at the ends. */
export function automationAt(points: Points | null | undefined, t: number) {
  if (!points?.length) return NaN;
  const n = points.length;
  if (!(t > points[0][0])) return points[0][1];
  if (t >= points[n - 1][0]) return points[n - 1][1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid][0] <= t) lo = mid; else hi = mid; }
  const a = points[lo], b = points[hi];
  return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
}

/** ∫ from 0 to t of a lane (exact: it is piecewise linear). */
function integral(points: Points, t: number) {
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

/** Playable lanes: known names, finite points sorted by time (ties dropped), values in range. */
function lanesOf(automation: Automation | null | undefined, g: ReturnType<typeof normalizeGlobals>) {
  const lanes: (Range & { name: string, points: Points })[] = [];
  const src = automation && typeof automation === 'object' ? automation : {};
  for (const [name, pts] of Object.entries(src)) {
    const range = GLOBALS[name as keyof typeof GLOBALS] || g.macros.find((m) => m.name === name);
    if (lanes.length >= MAX_LANES || !range || !Array.isArray(pts)) continue;
    const points = pts.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1])).slice(0, MAX_POINTS)
      .map((p) => Object.freeze([p[0], clamp(p[1], range.min, range.max)])).sort((a, b) => a[0] - b[0])
      .filter((p, i, all) => i === 0 || p[0] > all[i - 1][0]);
    if (points.length) lanes.push({ name, points: Object.freeze(points), min: range.min, max: range.max });
  }
  return lanes;
}

/** A look's globals and automation for renderFrame; `previous` (the look it replaces) keeps the clock continuous. */
export function prepareLook(look?: { globals?: Globals | null, automation?: Automation | null, bpm?: number | null }
  | null, previous?: Clock) {
  const g = normalizeGlobals(look?.globals);
  const lanes = lanesOf(look?.automation, g);
  const G: G = { energy: g.energy, speed: g.speed, level: g.level, hue: g.hue, saturation: g.saturation,
    palette: paletteColours(g.palette) || paletteColours(DEFAULT_PALETTE)! };
  for (const m of g.macros) G[m.name] = m.value;
  Object.seal(G);
  const ranges = new Map<string, Range>([...Object.entries(GLOBALS), ...g.macros.map((m) => [m.name, m] as const)]);
  const L = {
    G, g, lanes, bpm: isNum(look?.bpm) && look.bpm > 0 ? look.bpm : 120, palette: G.palette,
    speedLane: lanes.find((l) => l.name === 'speed')?.points || null, offset: 0, lastT: NaN, T: 0,
    grade: new Float64Array(9), graded: false, level: NaN, hue: NaN, sat: NaN,
    norm(name: string) {
      const r = ranges.get(name);
      return r ? clamp(((G[name] as number) - r.min) / (r.max - r.min)) : 0;
    },
  };
  if (previous && Number.isFinite(previous.lastT)) {
    L.offset = clockAt(previous, previous.lastT) - clockAt(L, previous.lastT);
    L.lastT = previous.lastT;
  }
  return L;
}

export type PreparedLook = ReturnType<typeof prepareLook>;
type Clock = { offset: number, lastT: number, speedLane: Points | null, g: { speed: number } };
/** Pattern time at show time t: ∫ speed dt, plus the offset. */
function clockAt(L: Clock, t: number) {
  const base = L.speedLane ? integral(L.speedLane, t) : L.g.speed === 1 ? t : L.g.speed * t;
  return L.offset + base;
}

/** Frame t: G (statics, then automation), the clock, the grade, RUN. No allocation. */
export function lookFrame(L: PreparedLook, t: number) {
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
/** level × saturation × hue rotation as one 3×3 matrix; identity skips it. */
function setGrade(L: PreparedLook, level: number, hue: number, sat: number) {
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

const cl = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);
/** The composite clamped, graded and clamped again. */
export function finish(rgb: Float32Array, n: number, L?: PreparedLook | null) {
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

const SHAPES = ['sine', 'tri', 'saw', 'square'];
const MODS: Record<string, number> = { lfo: 0, global: 1, envelope: 2 };
/** Is v a binding ({ mod, … }) rather than a value? */
export const isBinding = (v: unknown): v is Binding => v !== null && typeof v === 'object' && !Array.isArray(v)
  && typeof (v as Binding).mod === 'string';

/** Values P from a schema and overrides (colours as [r, g, b]; a binding starts at the default). */
export function resolveParams(schema: ParamSchema | undefined, overrides: unknown) {
  const P: Values = {};
  const o = (overrides && typeof overrides === 'object' ? overrides : {}) as Record<string, unknown>;
  for (const [key, d] of Object.entries(schema || {})) {
    const has = Object.prototype.hasOwnProperty.call(o, key) && o[key] !== null && o[key] !== undefined
      && !isBinding(o[key]);
    const v = has ? o[key] : d.value;
    if (d.type === 'color') {
      let c;
      if (Array.isArray(v) && v.length >= 3) c = [+v[0] || 0, +v[1] || 0, +v[2] || 0];
      else { try { c = hex(v as string); } catch { c = hex(d.value); } }
      P[key] = c;
    } else if (d.type === 'toggle') {
      P[key] = !!v;
    } else if (d.type === 'choice') {
      P[key] = typeof v === 'string' && d.options.includes(v) ? v : d.value;
    } else {
      const n = Number(v);
      P[key] = Number.isFinite(n) ? n : d.value;
    }
  }
  return P;
}

/** The bound number params, for applyMods. */
export function paramMods(schema: ParamSchema | undefined, overrides: unknown) {
  const out = [];
  const o = (overrides && typeof overrides === 'object' ? overrides : {}) as Record<string, unknown>;
  for (const [key, d] of Object.entries(schema || {})) {
    const v = Object.prototype.hasOwnProperty.call(o, key) ? o[key] : null;
    if (d.type !== 'number' || !isBinding(v) || !(v.mod in MODS)) continue;
    const b = v as Record<string, unknown>, lo = d.min, hi = d.max;
    const num = (x: unknown, dflt: number) => (isNum(x) ? x : dflt);
    out.push({
      key, kind: MODS[v.mod]!, lo, hi, from: num(b.from, lo), to: num(b.to, hi), name: String(b.name ?? ''),
      shape: Math.max(0, SHAPES.indexOf(b.shape as string)), rate: num(b.rate, 1), beats: b.unit === 'beats',
      depth: num(b.depth, (hi - lo) / 4), center: num(b.center, d.value),
    });
  }
  return out;
}

/** −1..1 at phase f (0..1): sine, triangle, saw or square. */
function lfo(shape: number, f: number) {
  switch (shape) {
    case 1: return 1 - 4 * Math.abs(f - 0.5);
    case 2: return 2 * f - 1;
    case 3: return f < 0.5 ? 1 : -1;
    default: return Math.sin(TAU * f);
  }
}

/** Each bound param's value this frame into P (t: show time; env: the clip envelope). No allocation. */
export function applyMods(mods: ReturnType<typeof paramMods>, P: Values, t: number, env: number,
  look: PreparedLook) {
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    let v;
    if (m.kind === 0) {
      const ph = t * m.rate * (m.beats ? look.bpm / 60 : 1);
      v = m.center + m.depth * lfo(m.shape, ph - Math.floor(ph));
    } else {
      v = m.from + (m.to - m.from) * (m.kind === 1 ? look.norm(m.name) : env);
    }
    P[m.key] = v < m.lo ? m.lo : v > m.hi ? m.hi : v === v ? v : m.lo;
  }
}
