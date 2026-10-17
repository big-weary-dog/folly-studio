// What the API accepts as a look (SPEC "Looks", "Timeline"): strict, a 400 naming the first
// problem. Generated looks are cleaned more leniently by src/generate/validate.js.

import { BLENDS, MAX_CLIPS, MAX_DURATION } from '../public/js/pattern-core.js';
import { HttpError } from './auth.js';

export const MAX_LAYERS = 8;
export const MAX_CODE_BYTES = 20 * 1024;
export const bad = (msg) => { throw new HttpError(400, msg); };
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype;
const isShortString = (v, max = 200) => typeof v === 'string' && v.length <= max;
const isNumber = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const LAYER_KEYS = new Set(['id', 'title', 'code', 'groups', 'blend', 'level', 'params', 'clips']);
const ms = (v) => Math.round(v * 1000) / 1000; // times are kept to the millisecond

function seconds(v, what, lo = 0, hi = MAX_DURATION) {
  if (!isNumber(v, lo, hi)) bad(`${what} must be a number of seconds from ${lo} to ${hi}.`);
  return ms(v);
}

/** A layer's clips: [{ start, end, fadeIn = 0, fadeOut = 0 }] seconds, sorted; overlaps refused. */
function cleanClips(v, at) {
  if (!Array.isArray(v)) bad(`${at}: clips must be an array.`);
  if (v.length > MAX_CLIPS) bad(`${at}: at most ${MAX_CLIPS} clips.`);
  const clips = v.map((c, j) => {
    const where = `${at}, clip ${j + 1}`;
    if (!isPlainObject(c)) bad(`${where} must be an object.`);
    const start = seconds(c.start, `${where}: start`);
    const end = seconds(c.end, `${where}: end`);
    if (!(end > start)) bad(`${where}: end must be after start.`);
    const fade = (k) => seconds(c[k] ?? 0, `${where}: ${k}`);
    return { start, end, fadeIn: fade('fadeIn'), fadeOut: fade('fadeOut') };
  }).sort((a, b) => a.start - b.start);
  for (let j = 1; j < clips.length; j++) {
    const a = clips[j - 1], b = clips[j];
    if (b.start < a.end) bad(`${at}: clips overlap (${a.start}–${a.end} s and ${b.start}–${b.end} s).`);
  }
  return clips;
}

export const cleanDuration = (v) => seconds(v, 'duration', 1, MAX_DURATION);

/** A tempo of 40–240; null clears it (undefined). */
export function cleanBpm(v) {
  if (v === null) return undefined;
  if (!isNumber(v, 40, 240)) bad('bpm must be a number from 40 to 240, or null.');
  return ms(v);
}

const paramValueOk = (v) => (typeof v === 'number' ? Number.isFinite(v)
  : typeof v === 'boolean' || (typeof v === 'string' && v.length <= 200)
  || (Array.isArray(v) && v.length <= 16 && v.every((x) => typeof x === 'number' && Number.isFinite(x))));

/** Validates and normalizes a look's layers (defaults: blend add, level 1, groups [cathedral], params {}). */
export function validateLayers(layers) {
  if (!Array.isArray(layers)) bad('layers must be an array.');
  if (layers.length > MAX_LAYERS) bad(`A look can have at most ${MAX_LAYERS} layers.`);
  const ids = new Set();
  return layers.map((l, i) => {
    const at = `Layer ${i + 1}`;
    if (!isPlainObject(l)) bad(`${at} must be an object.`);
    if (typeof l.code !== 'string') bad(`${at}: code must be a string.`);
    if (Buffer.byteLength(l.code) > MAX_CODE_BYTES) bad(`${at}: code is over ${MAX_CODE_BYTES / 1024} kB.`);
    const id = l.id ?? `l${i + 1}`;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(id)) {
      bad(`${at}: id must be 1–64 letters, digits or _.:-`);
    }
    if (ids.has(id)) bad(`${at}: duplicate layer id ${id}.`);
    ids.add(id);
    const title = l.title ?? '';
    if (!isShortString(title)) bad(`${at}: title must be a string of at most 200 characters.`);
    const groups = l.groups ?? ['cathedral'];
    if (!Array.isArray(groups) || groups.length > 64 || !groups.every((g) => isShortString(g, 64) && g.length >= 1)) {
      bad(`${at}: groups must be an array of group ids.`);
    }
    const blend = l.blend ?? 'add';
    if (!BLENDS.includes(blend)) bad(`${at}: blend must be one of ${BLENDS.join(', ')}.`);
    const level = l.level ?? 1;
    if (!isNumber(level, 0, 1)) bad(`${at}: level must be a number from 0 to 1.`);
    const params = l.params ?? {};
    if (!isPlainObject(params)) bad(`${at}: params must be an object.`);
    const keys = Object.keys(params);
    if (keys.length > 64) bad(`${at}: too many params.`);
    for (const k of keys) {
      if (k.length > 64 || !paramValueOk(params[k])) bad(`${at}: param ${k.slice(0, 64)} has an unsupported value.`);
    }
    const clips = l.clips == null ? [] : cleanClips(l.clips, at); // none: always on
    // Keep small UI flags the client may add (e.g. enabled, solo); drop anything bulky.
    const extra = {};
    for (const [k, v] of Object.entries(l)) {
      if (LAYER_KEYS.has(k) || Object.keys(extra).length >= 16 || k.length > 64) continue;
      if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || isShortString(v)) extra[k] = v;
    }
    return { id, title, code: l.code, groups: [...groups], blend, level, params: { ...params },
      ...(clips.length ? { clips } : {}), ...extra };
  });
}

export function cleanTitle(v, { required }) {
  if (v === undefined && !required) return undefined;
  if (typeof v !== 'string' || !v.trim()) bad('title is required.');
  if (v.trim().length > 200) bad('title must be at most 200 characters.');
  return v.trim();
}

export function cleanSummary(v) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > 2000) bad('summary must be a string of at most 2000 characters.');
  return v.trim();
}

export function cleanBool(v, name) {
  if (typeof v !== 'boolean') bad(`${name} must be true or false.`);
  return v;
}
