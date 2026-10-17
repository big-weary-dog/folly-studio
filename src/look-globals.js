// What the API accepts as a look's globals and automation (SPEC "Looks"): strict, a 400 naming the first problem.
// A palette given by name is filled in from data/palettes.json, so a stored look carries its colours.

import PALETTES from '../public/data/palettes.json' with { type: 'json' };
import { GLOBALS, macroNameOk, MAX_LANES, MAX_MACROS, MAX_POINTS, MAX_DURATION, PALETTE_ROLES }
  from '../public/js/pattern-core.js';
import { HttpError } from './auth.js';

const bad = (msg) => { throw new HttpError(400, msg); };
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const round = (v, k = 1e6) => Math.round(v * k) / k;
const HEX = /^#[0-9a-f]{6}$/i;
const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);
const MAX_PER_ROLE = 16;
export const PALETTE_NAMES = Object.freeze(PALETTES.palettes.map((p) => p.name));

/** A palette by name from data/palettes.json, as stored in a look: { name, low, body, accent, high }. */
export function namedPalette(name) {
  const p = PALETTES.palettes.find((x) => x.name === name);
  return p ? Object.fromEntries([['name', p.name], ...PALETTE_ROLES.map((r) => [r, [...p[r]]])]) : null;
}

function cleanPalette(v) {
  if (typeof v === 'string') return namedPalette(v) || bad(`globals.palette: no palette called ${v.slice(0, 40)}.`);
  if (!isObject(v)) bad('globals.palette must be a palette name or { name, low, body, accent, high }.');
  const out = { name: typeof v.name === 'string' ? v.name.slice(0, 64) : '' };
  let n = 0;
  for (const role of PALETTE_ROLES) {
    const list = v[role] ?? [];
    const ok = Array.isArray(list) && list.length <= MAX_PER_ROLE
      && list.every((c) => typeof c === 'string' && HEX.test(c));
    if (!ok) {
      bad(`globals.palette.${role} must be up to ${MAX_PER_ROLE} '#rrggbb' colours.`);
    }
    out[role] = list.map((c) => c.toLowerCase());
    n += list.length;
  }
  if (!n) bad('globals.palette has no colours.');
  return out;
}

function cleanMacros(v) {
  if (!isObject(v)) bad('globals.macros must be an object of { value, min, max }.');
  const names = Object.keys(v);
  if (names.length > MAX_MACROS) bad(`At most ${MAX_MACROS} macros.`);
  const out = {};
  for (const name of names) {
    if (!macroNameOk(name)) bad(`Macro ${name.slice(0, 40)}: a name is a lowercase letter, then letters, digits or _, `
      + 'and not one of energy, speed, level, hue, saturation or palette.');
    const m = v[name];
    if (!isObject(m)) bad(`Macro ${name} must be { value, min, max }.`);
    const min = m.min ?? 0, max = m.max ?? 1;
    if (!isNumber(min, -1e6, 1e6) || !isNumber(max, -1e6, 1e6) || !(max > min)) {
      bad(`Macro ${name}: min and max must be numbers, max above min.`);
    }
    const value = m.value ?? min;
    if (!isNumber(value, min, max)) bad(`Macro ${name}: value must be a number from min to max.`);
    out[name] = { value: round(value), min: round(min), max: round(max) };
  }
  return out;
}

/** A look's globals (all optional): the built-ins in range, a palette, macros. null clears them (undefined). */
export function cleanGlobals(v) {
  if (v === null) return undefined;
  if (!isObject(v)) bad('globals must be an object.');
  const out = {};
  for (const key of Object.keys(v)) {
    const d = own(GLOBALS, key);
    if (d) {
      if (!isNumber(v[key], d.min, d.max)) bad(`globals.${key} must be a number from ${d.min} to ${d.max}.`);
      out[key] = round(v[key]);
    } else if (key === 'palette') out.palette = cleanPalette(v.palette);
    else if (key === 'macros') out.macros = cleanMacros(v.macros);
    else bad(`globals.${key.slice(0, 40)} is not a global.`);
  }
  return out;
}

/**
 * A look's automation: { name: [[t, v], …] } for built-in globals and the look's macros, points sorted by time
 * (0–600 s, to the ms; one per time) with values in the global's range. null clears it (undefined).
 */
export function cleanAutomation(v, globals) {
  if (v === null) return undefined;
  if (!isObject(v)) bad('automation must be an object of lanes.');
  const names = Object.keys(v);
  if (names.length > MAX_LANES) bad(`At most ${MAX_LANES} automation lanes.`);
  const out = {};
  for (const name of names) {
    const range = own(GLOBALS, name) || own(globals?.macros, name);
    if (!range) bad(`automation.${name.slice(0, 40)}: automate a global or one of the look's macros.`);
    const pts = v[name];
    if (!Array.isArray(pts) || !pts.length || pts.length > MAX_POINTS) {
      bad(`automation.${name} must be 1–${MAX_POINTS} points [t, value].`);
    }
    const list = pts.map((p) => {
      const ok = Array.isArray(p) && p.length === 2 && isNumber(p[0], 0, MAX_DURATION)
        && isNumber(p[1], range.min, range.max);
      if (!ok) {
        bad(`automation.${name}: each point is [seconds 0–${MAX_DURATION}, value ${range.min}–${range.max}].`);
      }
      return [Math.round(p[0] * 1000) / 1000, round(p[1])];
    }).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < list.length; i++) {
      if (list[i][0] === list[i - 1][0]) bad(`automation.${name}: two points at ${list[i][0]} s.`);
    }
    out[name] = list;
  }
  return out;
}
