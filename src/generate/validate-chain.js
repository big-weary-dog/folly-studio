// Generated module chains, globals and automation, cleaned leniently (what cannot be used is dropped, with a note)
// and then held to the API's own rules (src/look-globals.js). Code is only inspected as text, never run.

import { GLOBALS, macroNameOk, MAX_LANES, MAX_MACROS, MAX_POINTS } from '../../public/js/pattern-core.js';
import { cleanAutomation, cleanGlobals, PALETTE_NAMES } from '../look-globals.js';

const FUNCTION = { source: 'pixel', warp: 'warp', filter: 'filter' };
const KIND_ALIASES = { pattern: 'source', effect: 'filter', transform: 'warp' };
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const MAX_GENERATED_MODULES = 6;

/**
 * A layer's modules: [{ kind, title, code, ref?, params?, input?, as?, blend?, id? }] → the chain as stored, or null
 * when no source survives. checkCode(code, fn) → { code } | { error }; checkParams and checkBlend as for layers.
 */
export function checkModules(modules, { checkCode, checkParams, checkBlend, cleanTitle, library, drop }) {
  const out = [], ids = new Set();
  for (const [j, m] of (Array.isArray(modules) ? modules : []).entries()) {
    const at = (why) => drop(`module ${j + 1}: ${why}`);
    if (out.length >= MAX_GENERATED_MODULES) { at(`more than ${MAX_GENERATED_MODULES} modules`); continue; }
    if (!m || typeof m !== 'object') { at('not an object'); continue; }
    const k = typeof m.kind === 'string' ? m.kind.trim().toLowerCase() : 'source';
    const kind = FUNCTION[k] ? k : KIND_ALIASES[k];
    if (!kind) { at(`unknown kind ${String(m.kind).slice(0, 20)}`); continue; }
    const { code, error } = checkCode(m.code, FUNCTION[kind]);
    if (error) { at(error); continue; }
    const id = typeof m.id === 'string' && ID.test(m.id) && !ids.has(m.id) ? m.id : `m${out.length + 1}`;
    ids.add(id);
    const ref = typeof m.ref === 'string' && library.some((p) => p.name === m.ref) ? m.ref : undefined;
    out.push({ id, kind, title: cleanTitle(m.title) || ref || kind, ...(ref ? { ref } : {}), code,
      params: checkParams(m.params), ...(kind === 'filter' && typeof m.input === 'string' ? { input: m.input } : {}),
      ...(kind === 'source' && m.as === 'input' ? { as: 'input' } : {}),
      ...(m.blend != null ? { blend: checkBlend(m.blend) } : {}) });
  }
  // A filter's input names an earlier source, or nothing.
  for (const [j, m] of out.entries()) {
    if (m.input && !out.slice(0, j).some((s) => s.id === m.input && s.kind === 'source')) delete m.input;
  }
  return out.some((m) => m.kind === 'source') ? out : null;
}

/** Globals as the model gave them (macros as a list or a map; palette by name) → stored globals, or undefined. */
export function checkGlobals(g, drop) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return undefined;
  const out = {};
  for (const [k, d] of Object.entries(GLOBALS)) if (finite(g[k])) out[k] = clamp(g[k], d.min, d.max);
  const name = typeof g.palette === 'string' ? g.palette.trim().toLowerCase() : g.palette?.name;
  if (PALETTE_NAMES.includes(name)) out.palette = name;
  else if (g.palette != null) drop(`palette ${String(name).slice(0, 30)} is not one of ${PALETTE_NAMES.join(', ')}`);
  const list = Array.isArray(g.macros) ? g.macros
    : g.macros && typeof g.macros === 'object' ? Object.entries(g.macros).map(([n, m]) => ({ ...m, name: n })) : [];
  const macros = {};
  for (const m of list.slice(0, MAX_MACROS)) {
    if (!m || !macroNameOk(m.name)) { drop(`macro ${String(m?.name).slice(0, 30)}: not a usable name`); continue; }
    const min = finite(m.min) ? m.min : 0, max = finite(m.max) && m.max > min ? m.max : min + 1;
    macros[m.name] = { value: clamp(finite(m.value) ? m.value : min, min, max), min, max };
  }
  if (Object.keys(macros).length) out.macros = macros;
  try {
    return Object.keys(out).length ? cleanGlobals(out) : undefined;
  } catch (e) {
    drop(`globals: ${e.message}`);
    return undefined;
  }
}

/** Automation as a list of { name, points } or a map → stored lanes (sorted, one point per time), or undefined. */
export function checkAutomation(a, globals, drop) {
  const lanes = Array.isArray(a) ? a : a && typeof a === 'object'
    ? Object.entries(a).map(([name, points]) => ({ name, points })) : [];
  const out = {};
  for (const lane of lanes.slice(0, MAX_LANES)) {
    const range = (lane && Object.hasOwn(GLOBALS, lane.name) && GLOBALS[lane.name])
      || (globals?.macros && Object.hasOwn(globals.macros, lane?.name) && globals.macros[lane.name]);
    if (!range || !Array.isArray(lane.points)) { drop(`automation of ${String(lane?.name).slice(0, 30)}`); continue; }
    const seen = new Set();
    const points = lane.points.filter((p) => Array.isArray(p) && finite(p[0]) && finite(p[1]))
      .map((p) => [Math.round(clamp(p[0], 0, 600) * 1000) / 1000, clamp(p[1], range.min, range.max)])
      .sort((x, y) => x[0] - y[0]).filter((p) => !seen.has(p[0]) && seen.add(p[0])).slice(0, MAX_POINTS);
    if (points.length) out[lane.name] = points;
  }
  try {
    return Object.keys(out).length ? cleanAutomation(out, globals) : undefined;
  } catch (e) {
    drop(`automation: ${e.message}`);
    return undefined;
  }
}
