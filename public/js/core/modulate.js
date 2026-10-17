// Param values (SPEC "Param bindings"): a layer's or module's overrides over its code's defaults, and number params
// bound to an LFO, a global or the clip envelope, resolved once per frame.
import { hex, isNum, TAU } from './stdlib.js';

const SHAPES = ['sine', 'tri', 'saw', 'square'];
const MODS = { lfo: 0, global: 1, envelope: 2 };
/** Is v a binding ({ mod: 'lfo' | 'global' | 'envelope', … }) rather than a value? */
export const isBinding = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.mod === 'string';

/** Current values P from a schema and overrides (colours become [r, g, b]; a binding starts at the default). */
export function resolveParams(schema, overrides) {
  const P = {};
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  for (const key of Object.keys(schema || {})) {
    const d = schema[key];
    const has = Object.prototype.hasOwnProperty.call(o, key) && o[key] !== null && o[key] !== undefined
      && !isBinding(o[key]);
    const v = has ? o[key] : d.value;
    if (d.type === 'color') {
      let c;
      if (Array.isArray(v) && v.length >= 3) c = [+v[0] || 0, +v[1] || 0, +v[2] || 0];
      else { try { c = hex(v); } catch { c = hex(d.value); } }
      P[key] = c;
    } else if (d.type === 'toggle') {
      P[key] = !!v;
    } else {
      const n = +v;
      P[key] = Number.isFinite(n) ? n : d.value;
    }
  }
  return P;
}

/** The bound number params of a schema and its overrides, ready for applyMods (usually none). */
export function paramMods(schema, overrides) {
  const out = [];
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  for (const key of Object.keys(schema || {})) {
    const d = schema[key], v = Object.prototype.hasOwnProperty.call(o, key) ? o[key] : null;
    if (d.type !== 'number' || !isBinding(v) || !(v.mod in MODS)) continue;
    const lo = d.min, hi = d.max, num = (x, dflt) => (isNum(x) ? x : dflt);
    out.push({
      key, kind: MODS[v.mod], lo, hi, from: num(v.from, lo), to: num(v.to, hi), name: String(v.name ?? ''),
      shape: Math.max(0, SHAPES.indexOf(v.shape)), rate: num(v.rate, 1), beats: v.unit === 'beats',
      depth: num(v.depth, (hi - lo) / 4), center: num(v.center, d.value),
    });
  }
  return out;
}

/** −1..1 at phase f (0..1): sine, triangle, saw or square. */
function lfo(shape, f) {
  switch (shape) {
    case 1: return 1 - 4 * Math.abs(f - 0.5);
    case 2: return 2 * f - 1;
    case 3: return f < 0.5 ? 1 : -1;
    default: return Math.sin(TAU * f);
  }
}

/**
 * This frame's value of each bound param, into P. t: show time (s); env: the layer's clip envelope; look: the
 * prepared look (its bpm and globals as 0..1, `norm(name)`). No allocation.
 */
export function applyMods(mods, P, t, env, look) {
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
