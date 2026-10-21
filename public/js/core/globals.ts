// The look's globals as G (SPEC "Globals"): its palette, tempo and macros; automation per frame; param values and
// bindings (SPEC "Param bindings").
import type { Automation, Binding, Globals, Range } from '../../../shared/schemas/look.ts';
import type { ParamSchema } from './compile.ts';
import { pickColour } from './picks.ts';
import { type Picture, readPicture } from './picture.ts';
import { clamp, DEFAULT_PALETTE, isNum, paletteColours, RUN, TAU } from './stdlib.ts';
import type { PaletteColours, PaletteHex } from './stdlib.ts';

/** G: the look's tempo, palette and macros by name (SPEC "Globals"). */
export type G = { bpm: number, palette: PaletteColours, [macro: string]: number | PaletteColours };
/** P: a module's param values (colours as [r, g, b], choices as their name). */
export type Values = Record<string, number | boolean | number[] | string | Picture>;
type Points = readonly (readonly number[])[];
type MacroMod = NonNullable<NonNullable<Globals['macros']>[string]['mod']>;

export const MAX_MACROS = 16;
export const MAX_LANES = 16;
export const MAX_POINTS = 256;
/** Globals looks once had: still read (energy becomes a macro), never kept. */
export const OLD_GLOBALS: readonly string[] = Object.freeze(['speed', 'level', 'hue', 'saturation', 'energy']);
const MACRO_NAME = /^[a-z][A-Za-z0-9_]{0,31}$/;
/** May `name` be a macro: not one of G's own, nor anything every object has? */
export const macroNameOk = (name: unknown): name is string => typeof name === 'string' && MACRO_NAME.test(name)
  && name !== 'palette' && name !== 'bpm' && !(name in Object.prototype);

type Loaded = { globals?: Globals | null, automation?: Automation | null, layers?: unknown };
/** Does anything in v follow energy: a binding (or a macro's), or code reading G.energy? */
const followsEnergy = (v: unknown): boolean => (typeof v === 'string' ? /\bG\.energy\b/.test(v)
  : Array.isArray(v) ? v.some(followsEnergy) : !!v && typeof v === 'object' && ((isBinding(v)
    && (v.mod === 'global' ? v.name === 'energy' : v.mod === 'lfo' && (v.amount === 'energy' || v.pace === 'energy')))
    || Object.values(v).some(followsEnergy)));

/** A look as it plays now: the old globals dropped, and energy, once a global, a macro on the looks that depend on it
 * (store, automate or follow it; its stored value, else 0.5). Looks are read this way, never rewritten. */
export function upgradeGlobals<T extends Loaded>(look: T): T {
  const src = look.globals && typeof look.globals === 'object' ? look.globals as Globals & Record<string, unknown>
    : null;
  const lanes = look.automation && typeof look.automation === 'object' ? look.automation : null;
  if (!OLD_GLOBALS.some((k) => (src && k in src) || (lanes && k !== 'energy' && k in lanes))
    && (src?.macros?.energy || !(lanes?.energy || followsEnergy(src?.macros) || followsEnergy(look.layers)))) {
    return look;
  }
  const { speed: _s, level: _l, hue: _h, saturation: _t, energy, ...g } = src ?? {};
  const { speed: _a, level: _b, hue: _c, saturation: _d, ...automation } = lanes ?? {};
  const wants = isNum(energy) || !!lanes?.energy || followsEnergy(g.macros) || followsEnergy(look.layers);
  const macros = g.macros && typeof g.macros === 'object' ? g.macros : {};
  if (wants && !macros.energy && Object.keys(macros).length < MAX_MACROS) {
    g.macros = { energy: { value: isNum(energy) ? clamp(energy) : 0.5, min: 0, max: 1 }, ...macros };
  }
  return { ...look, ...src ? { globals: g } : g.macros ? { globals: g } : {},
    ...lanes ? { automation: Object.keys(automation).length ? automation : null } : {} };
}

/** Lenient: a palette, macros: [{ name, value, min, max }]. */
export function normalizeGlobals(g?: Globals | null) {
  const src: Globals = g && typeof g === 'object' ? g : {};
  const palette: PaletteHex = src.palette && typeof src.palette === 'object' ? src.palette : DEFAULT_PALETTE;
  const macros: (Range & { name: string, value: number, mod?: MacroMod })[] = [];
  const given = src.macros && typeof src.macros === 'object' ? src.macros : {};
  for (const [name, m] of Object.entries(given)) {
    if (macros.length >= MAX_MACROS || !macroNameOk(name) || !m || typeof m !== 'object') continue;
    const min = isNum(m.min) ? m.min : 0, max = isNum(m.max) && m.max > min ? m.max : min + 1;
    const mod = fader(m.mod, given);
    macros.push({ name, min, max, value: isNum(m.value) ? clamp(m.value, min, max) : min, ...mod ? { mod } : {} });
  }
  return { palette, macros };
}

/** A macro's own binding, if it makes it a modulator: an LFO, the tempo or a global, never the clip envelope, and
 * naming only faders (macros without a binding), so a modulator never follows a modulator. */
function fader(b: unknown, macros: Record<string, { mod?: unknown } | undefined>): MacroMod | undefined {
  if (!isBinding(b) || !['lfo', 'beats', 'global'].includes(b.mod)) return undefined;
  const ok = (n: unknown) => typeof n === 'string' && Object.hasOwn(macros, n) && !isBinding(macros[n]?.mod);
  if (b.mod === 'global' && !ok(b.name)) return undefined;
  if (b.mod !== 'lfo') return b as MacroMod;
  const { amount, pace, ...rest } = b;
  return { ...rest, ...ok(amount) ? { amount } : {}, ...ok(pace) ? { pace } : {} };
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
    const range = g.macros.find((m) => m.name === name);
    if (lanes.length >= MAX_LANES || !range || !Array.isArray(pts)) continue;
    const points = pts.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1])).slice(0, MAX_POINTS)
      .map((p) => Object.freeze([p[0], clamp(p[1], range.min, range.max)])).sort((a, b) => a[0] - b[0])
      .filter((p, i, all) => i === 0 || p[0] > all[i - 1][0]);
    if (points.length) lanes.push({ name, points: Object.freeze(points), min: range.min, max: range.max });
  }
  return lanes;
}

/** A look's globals and automation for renderFrame (upgradeGlobals: as it plays now); `previous` (the look it
 * replaces) keeps the clock continuous. */
export function prepareLook(look?: Loaded & { bpm?: number | null } | null, previous?: Clock) {
  const now = look ? upgradeGlobals(look) : look, g = normalizeGlobals(now?.globals);
  const lanes = lanesOf(now?.automation, g), bpm = isNum(look?.bpm) && look.bpm > 0 ? look.bpm : 120;
  const G: G = { bpm, palette: paletteColours(g.palette) || paletteColours(DEFAULT_PALETTE)! };
  for (const m of g.macros) G[m.name] = m.value;
  Object.seal(G);
  const ranges = new Map<string, Range>(g.macros.map((m) => [m.name, m] as const));
  // Where each name's static value lives (read when used, so a live engine may set it in place).
  const fixed = new Map<string, () => number>(g.macros.map((m) => [m.name, () => m.value] as const));
  const laneOf = new Map(lanes.map((l) => [l.name, l.points]));
  // Modulators: macros a binding moves (SPEC "Globals"), unless a lane does.
  const moving = g.macros.flatMap((m) => (m.mod && !laneOf.has(m.name)
    ? [[m.name, modOf(m.name, m.mod, m.min, m.max, m.value, null)!] as const] : []));
  const movingOf = new Map(moving), paceOffset = new Map<string, number>();
  const L = {
    G, g, lanes, bpm, palette: G.palette, beat0: 0, moving,
    offset: 0, lastT: NaN, T: 0, paceOffset,
    norm(name: string) {
      const r = ranges.get(name);
      return r ? clamp(((G[name] as number) - r.min) / (r.max - r.min)) : 0;
    },
    /** A macro at show time t, 0..1 of its range: its lane there, its modulator's value, else its value
     * (integrated clocks). */
    normAt(name: string, t: number): number {
      const r = ranges.get(name), lane = laneOf.get(name), m = lane ? undefined : movingOf.get(name);
      if (!r) return 0;
      return clamp(((lane ? automationAt(lane, t) : m ? L.modAt(m, t) : fixed.get(name)!()) - r.min) / (r.max - r.min));
    },
    /** A modulator's binding at show time t. */
    modAt(m: Mod, t: number): number { return modValue(m, t, m.kind === 1 ? L.normAt(m.name, t) : 0, 1, L); },
    /** ∫ from 0 to t of a fader's value, what a `pace` multiplies an LFO's phase by: exact on a lane. */
    paceAt(name: string, t: number): number {
      const lane = laneOf.get(name), f = fixed.get(name);
      return lane ? integral(lane, t) : f ? f() * t + (paceOffset.get(name) ?? 0) : t;
    },
    /** A live engine set fader `name` from `from` to `to` at show time `at`: what it paces goes on unbroken. */
    repace(name: string, from: number, to: number, at: number) {
      paceOffset.set(name, (paceOffset.get(name) ?? 0) + (from - to) * at);
    },
  };
  if (previous && Number.isFinite(previous.lastT)) { L.offset = previous.offset; L.lastT = previous.lastT; }
  return L;
}

export type PreparedLook = ReturnType<typeof prepareLook>;
type Clock = { offset: number, lastT: number };

/** Frame t: G (statics, then automation), the clock (show time, plus the offset a followed engine gives), RUN.
 * No allocation. */
export function lookFrame(L: PreparedLook, t: number) {
  if (t < L.lastT) { L.offset = 0; L.paceOffset.clear(); }   // looped, restarted or sought back: the canonical clocks
  L.lastT = t;
  const G = L.G, g = L.g;
  G.bpm = L.bpm; G.palette = L.palette;
  for (let i = 0; i < g.macros.length; i++) G[g.macros[i].name] = g.macros[i].value;
  for (let i = 0; i < L.lanes.length; i++) G[L.lanes[i].name] = automationAt(L.lanes[i].points, t);
  for (let i = 0; i < L.moving.length; i++) G[L.moving[i][0]] = L.modAt(L.moving[i][1], t);
  L.T = L.offset + t;
  RUN.G = G;
  RUN.palette = L.palette;
  RUN.t = t; RUN.T = L.T; RUN.look = L;
}

/** The composite clamped to 0..1. */
export function finish(rgb: Float32Array, n: number) {
  for (let i = 0; i < n; i++) { const v = rgb[i]; if (!(v > 0)) rgb[i] = 0; else if (v > 1) rgb[i] = 1; }
}

/** A text param's longest value (SPEC "Pattern code"). */
export const TEXT_MAX = 256;
/** A text param's value: printable ASCII, at most TEXT_MAX characters, else null. */
export const readText = (v: unknown) => (typeof v === 'string' && v.length <= TEXT_MAX && /^[ -~]*$/.test(v) ? v
  : null);

const SHAPES = ['sine', 'tri', 'saw', 'square', 'hold'];
const MODS: Record<string, number> = { lfo: 0, global: 1, envelope: 2, beats: 3 };
/** Is v a binding ({ mod, … }) rather than a value? */
export const isBinding = (v: unknown): v is Binding => v !== null && typeof v === 'object' && !Array.isArray(v)
  && typeof (v as Binding).mod === 'string';

/** Values P from a schema and overrides (colours, from picks, as [r, g, b]; a binding starts at the default). */
export function resolveParams(schema: ParamSchema | undefined, overrides: unknown) {
  const P: Values = {};
  const o = (overrides && typeof overrides === 'object' ? overrides : {}) as Record<string, unknown>;
  for (const [key, d] of Object.entries(schema || {})) {
    const has = Object.prototype.hasOwnProperty.call(o, key) && o[key] !== null && o[key] !== undefined
      && !isBinding(o[key]);
    const v = has ? o[key] : d.value;
    if (d.type === 'color') {
      P[key] = pickColour(d, v);
    } else if (d.type === 'toggle') {
      P[key] = !!v;
    } else if (d.type === 'choice') {
      // round, saved before clockwise, stays for the code saved with it (toward() reads it as clockwise)
      const old = v === 'round' && d.options.includes('clockwise');
      P[key] = typeof v === 'string' && (d.options.includes(v) || old) ? v : d.value;
    } else if (d.type === 'picture') {
      P[key] = readPicture(v) ?? d.value;
    } else if (d.type === 'text') {
      P[key] = readText(v) ?? d.value;
    } else {
      const n = Number(v);
      P[key] = Number.isFinite(n) ? n : d.value;
    }
  }
  return P;
}

/** The bound number params, for applyMods; with `turns` (a module's picks.rot), colour params' bound rotates too,
 * 0..1 by default and wrapping rather than held. */
export function paramMods(schema: ParamSchema | undefined, overrides: unknown, turns?: Values) {
  const out: Mod[] = [];
  const o = (overrides && typeof overrides === 'object' ? overrides : {}) as Record<string, unknown>;
  for (const [key, d] of Object.entries(schema || {})) {
    const own = Object.prototype.hasOwnProperty.call(o, key) ? o[key] : null;
    const turn = turns && d.type === 'color' && own && typeof own === 'object' ? (own as { rotate?: unknown }).rotate
      : null;
    const v = d.type === 'number' ? own : turn;
    const m = d.type === 'number' ? modOf(key, v, d.min, d.max, d.value, null)
      : turn ? modOf(key, v, -1e6, 1e6, 0, turns!, 0, 1) : null;
    if (m && d.type === 'number' && d.unit === 'minute') m.per *= 60;     // a speed a minute: per × bpm
    if (m) out.push(m);
  }
  return out;
}

/** A binding prepared for modValue: `key` the param (or macro) it sets, in `into` (null: P), held to lo..hi; `from`,
 * `to` and the depth default over flo..fhi (a rotate's 0..1), the centre to `dv`. Null: not a binding. */
function modOf(key: string, v: unknown, lo: number, hi: number, dv: number, into: Values | null, flo = lo, fhi = hi) {
  if (!isBinding(v) || !(v.mod in MODS)) return null;
  const b = v as Record<string, unknown>, num = (x: unknown, dflt: number) => (isNum(x) ? x : dflt);
  const name = (x: unknown) => (typeof x === 'string' ? x : '');
  return {
    key, into, kind: MODS[v.mod]!, lo, hi, from: num(b.from, flo), to: num(b.to, fhi), name: name(b.name),
    shape: Math.max(0, SHAPES.indexOf(b.shape as string)), rate: num(b.rate, 1), beats: b.unit === 'beats',
    depth: num(b.depth, (fhi - flo) / 4), center: num(b.center, dv), hold: clamp(num(b.hold, 0.5), 0, 0.95),
    per: num(b.per, 1), amount: name(b.amount), pace: name(b.pace),
  };
}

const ease = (x: number) => x * x * (3 - 2 * x);
/** −1..1 at phase f (0..1): sine, triangle, saw, square, or hold: from the bottom it eases up, holds, eases down and
 * holds, `hold` the share of the cycle spent holding (half at the top, half at the bottom). */
function lfo(shape: number, f: number, hold: number) {
  switch (shape) {
    case 1: return 1 - 4 * Math.abs(f - 0.5);
    case 2: return 2 * f - 1;
    case 3: return f < 0.5 ? 1 : -1;
    case 4: {
      const r = (1 - hold) / 2, top = r + hold / 2;
      return f < r ? 2 * ease(f / r) - 1 : f < top ? 1 : f < top + r ? 1 - 2 * ease((f - top) / r) : -1;
    }
    default: return Math.sin(TAU * f);
  }
}

export type Mod = NonNullable<ReturnType<typeof modOf>>;
/** A bound param's value at show time t, held to its range: `g` the global it reads (0..1), `env` the clip envelope;
 * a `beats` one is per × the tempo. An LFO's `amount` scales its swing by a global (0..1); its `pace` runs its
 * phase at its rate × a fader's value, integrated, so turning the fader never jumps the wave. */
export function modValue(m: Mod, t: number, g: number, env: number, look: PreparedLook) {
  let v;
  if (m.kind === 0) {
    const per = m.rate * (m.beats ? look.bpm / 60 : 1), from = m.beats ? look.beat0 : 0;
    const ph = per * (m.pace ? look.paceAt(m.pace, t) - (from ? look.paceAt(m.pace, from) : 0) : t - from);
    const depth = m.amount ? m.depth * look.normAt(m.amount, t) : m.depth;
    v = m.center + depth * lfo(m.shape, ph - Math.floor(ph), m.hold);
  } else if (m.kind === 3) {
    v = m.per * look.bpm / 60;
  } else {
    v = m.from + (m.to - m.from) * (m.kind === 1 ? g : env);
  }
  return v < m.lo ? m.lo : v > m.hi ? m.hi : v === v ? v : m.lo;
}

/** Each bound param's value this frame into P, a rotate's into its picks (t: show time; env: the clip envelope).
 * No allocation. */
export function applyMods(mods: readonly Mod[], P: Values, t: number, env: number, look: PreparedLook) {
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    (m.into || P)[m.key] = modValue(m, t, m.kind === 1 ? look.norm(m.name) : 0, env, look);
  }
}
