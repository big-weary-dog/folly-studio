// A refinement's answer as a list of edits (SPEC-generators "Refine"): the model names what changes in the look's
// composition, and the server applies it, so what was not asked about stays as it was, byte for byte, and the answer
// is short. The ops are generic, by path, so they follow the composition as it grows; a sweeping change may come back
// as a whole composition instead (`rewrite`). An edit that does not apply is reported with why, for one repair round.

import { EXPLAIN } from './composition.ts';
import type { Composition } from './refine.ts';

type Obj = Record<string, unknown>;
type Schema = Record<string, unknown>;
export type Edit = { op: string, path?: string, value?: unknown, module?: unknown, layer?: unknown, at?: number,
  why?: string };
export type Edited = { comp: Composition, failed: string[] };

const OPS = ['set', 'remove', 'insert', 'add_layer', 'remove_layer', 'move_layer', 'replace_layer'];
const MAX_EDITS = 40;
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const KEYS = ['title', 'id', 'name', 'use', 'module'];

const props = (s: unknown) => (isObj(s) && isObj(s.properties) ? s.properties as Record<string, Schema> : {});

/** The answer's JSON Schema: `edits`, or `rewrite` (the whole composition), after the round's critique and plan
 * (composition.ts EXPLAIN), each edit with its `why`. An edit's value, module and layer are
 * typed as the composition types them (a param's value, a list of words or numbers), never JSON in a string, which a
 * model escapes badly. */
export function editsSchema(composition: Schema): Schema {
  const str = { type: 'string' }, layer = props(composition).layers?.items;
  const module = props(props(layer).modules?.items ?? {}).params ? props(layer).modules!.items : undefined;
  const param = props(props(props(module).params?.items ?? {}).value ? props(module).params!.items : {}).value;
  const words = { type: 'array', items: { anyOf: [str, { type: 'number' }] } };
  const value = { anyOf: [...(isObj(param) && Array.isArray(param.anyOf) ? param.anyOf : [str, { type: 'number' }]),
    words] };
  const edit = { type: 'object', additionalProperties: false, required: ['op'], properties: {
    op: { type: 'string', enum: OPS }, path: str, value, ...(module ? { module } : {}), layer,
    at: { type: 'number' }, why: str } };
  return { type: 'object', additionalProperties: false, required: [], properties: { ...EXPLAIN,
    edits: { type: 'array', items: edit }, rewrite: composition } };
}

export const EDITS_GUIDE = `Answer with the edits that make the change, as { "edits": [...] }, applied in order to the
composition above; everything they do not touch stays exactly as it is. A path walks the composition by key, with a
list's item named by its title, id, name or use (else its index from 0): "layers/Rose/level",
"layers/Rose/modules/bars/params/speed", "globals/palette", "duration". A value is a param's value as the composition
has them (0.2, "ember", a binding { "mod": "lfo", "rate": 0.1 }) or a list (["spires"]). The ops:
- set { path, value }: a key, or a list item (a param not given yet is added: params/speed sets its value).
- remove { path }: a key or a list item (a param back to its default).
- insert { path, module, at? }: a module into the chain at path ("layers/Rose/modules"), at index at, else at the
  end; or { path, value, at? } for an item of another list. A list the look lacks ("globals/macros", "automation")
  is made: insert into it, never set a path inside it first.
- add_layer { layer, at? }: a new layer, on top unless at says where (0 is the bottom).
- remove_layer { path }, move_layer { path, at }, replace_layer { path, layer }: path names the layer ("Rose").
Each edit may say why, in a short sentence.
When the request remakes most of the look, answer { "rewrite": <the whole composition> } instead.`;

/** Every field name the composition's schema has, anywhere: a set may make only these (a typo is named, not kept). */
export function fieldsOf(schema: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) schema.forEach((v) => fieldsOf(v, out));
  else if (isObj(schema)) {
    if (isObj(schema.properties)) Object.keys(schema.properties).forEach((k) => out.add(k));
    Object.values(schema).forEach((v) => fieldsOf(v, out));
  }
  return out;
}

/** The list in `parent` holding `seg`'s item: its index, or -1. */
function find(list: unknown[], seg: string) {
  if (/^\d+$/.test(seg)) return Number(seg) < list.length ? Number(seg) : -1;
  for (const k of KEYS) {
    const i = list.findIndex((x) => isObj(x) && x[k] === seg);
    if (i >= 0) return i;
  }
  return list.findIndex((x) => isObj(x) && x.use === `ext:${seg}`);
}

/** A path's steps: split at `/`, else (a path with none) at `.`. */
function segments(path: unknown) {
  const p = String(path ?? '').trim().replace(/^\/+|\/+$/g, '');
  return p.split(p.includes('/') ? '/' : '.').map((s) => s.trim()).filter(Boolean);
}

/** The container of the path's last step, and that step; a string saying why when the path leads nowhere. `make`: a
 * missing key of the look itself (`globals`) is made an object on the way. */
function walk(root: Obj, path: unknown, make = false): { at: Obj | unknown[], key: string } | string {
  const segs = segments(path);
  if (!segs.length) return 'an empty path';
  let at: unknown = root;
  for (const [n, seg] of segs.entries()) {
    if (UNSAFE.has(seg)) return `${seg} is not a key`;
    if (n === segs.length - 1) return Array.isArray(at) || isObj(at) ? { at, key: seg } : `${segs.slice(0, n)
      .join('/')} is a value, not a list or an object`;
    const here = segs.slice(0, n + 1).join('/');
    if (Array.isArray(at)) {
      const i = find(at, seg);
      if (i < 0) return `no ${seg} in ${segs.slice(0, n).join('/') || 'the look'}${names(at)}`;
      at = at[i];
    } else if (isObj(at)) {
      if (make && at === root && !Object.hasOwn(at, seg)) at[seg] = {};
      if (!Object.hasOwn(at, seg)) return `no ${here}${Object.keys(at).length ? ` (it has ${Object.keys(at)
        .slice(0, 12).join(', ')})` : ''}`;
      at = at[seg];
    } else return `${here} is a value`;
  }
  return 'an empty path';
}

const names = (list: unknown[]) => {
  const n = list.map((x) => (isObj(x) ? KEYS.map((k) => x[k]).find((v) => typeof v === 'string') : undefined))
    .filter(Boolean);
  return n.length ? ` (it has ${n.slice(0, 12).join(', ')})` : '';
};

/** A value as given; a string that is JSON (an older answer's "0.2") as what it says; a string that starts as JSON
 * but is not (a fragment, text after it) an error, so the edit goes back rather than set a broken value. */
function parse(value: unknown): { ok: unknown } | { error: string } {
  if (typeof value !== 'string') return { ok: value };
  try { return { ok: JSON.parse(value) }; } catch { /* a word, or broken */ }
  return /^\s*[[{"]/.test(value) ? { error: `value is not JSON: ${value.slice(0, 60)}` } : { ok: value };
}

function set(root: Obj, path: unknown, raw: unknown, fields?: Set<string>) {
  if (raw === undefined) return 'no value';
  const parsed = parse(raw);
  if ('error' in parsed) return parsed.error;
  const w = walk(root, path, true), value = parsed.ok;
  if (typeof w === 'string') return w;
  const { at, key } = w;
  if (isObj(at)) {
    if (fields && !Object.hasOwn(at, key) && !fields.has(key)) return `${key} is not a field of a look`;
    at[key] = value;
    return '';
  }
  const i = find(at, key), item = at[i], whole = isObj(value) && 'name' in value && 'value' in value;
  // A named list's item (a param, an override) takes the value as its value (a binding, which has a name of its own,
  // too); a param not given yet is added.
  if (i < 0) {
    if (/^\d+$/.test(key)) return `no item ${key}: the list has ${at.length}`;
    if (at.length && !at.every((x) => isObj(x) && 'name' in x && 'value' in x)) return `no ${key}${names(at)}`;
    at.push(whole ? value : { name: key, value });
  } else if (isObj(item) && 'value' in item && !whole) item.value = value;
  else at[i] = value;
  return '';
}

function remove(root: Obj, path: unknown) {
  const w = walk(root, path);
  if (typeof w === 'string') return w;
  const { at, key } = w;
  if (isObj(at)) {
    if (!Object.hasOwn(at, key)) return `no ${key}`;
    delete at[key];
    return '';
  }
  const i = find(at, key);
  if (i < 0) return `no ${key}${names(at)}`;
  at.splice(i, 1);
  return '';
}

/** The list a path names (`layers` for the layer ops). `make`: a list the look lacks (`globals/macros`, `automation`)
 * is made empty, when its key is a field of a look. */
function listAt(root: Obj, path: unknown, make = false, fields?: Set<string>): unknown[] | string {
  const w = walk(root, path, make);
  if (typeof w === 'string') return w;
  if (make && isObj(w.at) && !Object.hasOwn(w.at, w.key) && (!fields || fields.has(w.key))) w.at[w.key] = [];
  const v = Array.isArray(w.at) ? w.at[find(w.at, w.key)] : w.at[w.key];
  return Array.isArray(v) ? v : `${segments(path).join('/')} is not a list`;
}

const place = (list: unknown[], at: unknown) => (typeof at === 'number' && Number.isFinite(at)
  ? Math.max(0, Math.min(list.length, Math.round(at))) : list.length);
const layerPath = (path: unknown) => (segments(path)[0] === 'layers' ? segments(path).join('/')
  : `layers/${segments(path).join('/')}`);

function apply(root: Obj, e: Edit, fields?: Set<string>): string {
  if (!isObj(e) || !OPS.includes(e.op)) return `unknown op ${String(e?.op).slice(0, 20)}`;
  if (String(e.path ?? '').length > 200 || JSON.stringify(e.value ?? '').length > 20_000) return 'too long';
  if (e.op === 'set') return set(root, e.path, e.value, fields);
  if (e.op === 'remove') return remove(root, e.path);
  if (e.op === 'insert') {
    if (e.value === undefined && e.module === undefined) return 'no module or value';
    const list = listAt(root, e.path, true, fields);
    if (typeof list === 'string') return list;
    const item = parse(e.module ?? e.value);
    if ('error' in item) return item.error;
    list.splice(place(list, e.at), 0, item.ok);
    return '';
  }
  const layers = Array.isArray(root.layers) ? root.layers : (root.layers = []) as unknown[];
  const parsed = parse(e.layer ?? e.value), layer = 'ok' in parsed ? parsed.ok : undefined;
  if (e.op === 'add_layer') {
    if (!isObj(layer)) return 'no layer';
    layers.splice(place(layers, e.at), 0, layer);
    return '';
  }
  const segs = segments(layerPath(e.path));
  if (segs.length !== 2) return `${String(e.path)} does not name a layer`;
  const i = find(layers, segs[1]!);
  if (i < 0) return `no layer ${segs[1]}${names(layers)}`;
  if (e.op === 'remove_layer') layers.splice(i, 1);
  else if (e.op === 'replace_layer') {
    if (!isObj(layer)) return 'no layer';
    layers[i] = layer;
  } else {
    const [moved] = layers.splice(i, 1);
    layers.splice(place(layers, e.at), 0, moved);
  }
  return '';
}

/** The answer applied to `base` (never changed): a rewrite (or a whole composition) as it is, else each edit in
 * order; an edit that does not apply is skipped and named in `failed` (`edits[2] set layers/Rose/levl: levl is not
 * a field of a look`); `fields`: the names a set may add (fieldsOf). */
export function applyEdits(base: Composition, answer: unknown, fields?: Set<string>): Edited {
  const a = isObj(answer) ? answer : {}, whole = isObj(a.rewrite) ? a.rewrite : a.edits ? null : a;
  if (whole && Array.isArray(whole.layers)) return { comp: whole as Composition, failed: [] }; // a look as it was asked

  const comp = structuredClone(base) as unknown as Obj, failed: string[] = [];
  const edits = Array.isArray(a.edits) ? a.edits : [];
  if (!edits.length) failed.push('no edits and no rewrite: the answer changes nothing');
  if (edits.length > MAX_EDITS) failed.push(`only the first ${MAX_EDITS} edits apply`);
  edits.slice(0, MAX_EDITS).forEach((e: Edit, i) => {
    const why = apply(comp, e, fields);
    if (why) failed.push(`edits[${i}] ${String(e?.op).slice(0, 20)} ${String(e?.path ?? '').slice(0, 80)}: ${why}`
      .replace(/\s+:/, ':').slice(0, 300));
  });
  return { comp: comp as unknown as Composition, failed };
}

/** The repair turn for edits that did not apply. */
export function buildEditsRepairMessage(failed: readonly string[]) {
  return `These edits did not apply to the composition:
${failed.slice(0, 20).map((f) => `- ${f}`).join('\n')}

Answer the whole list of edits again, fixed, applied as before to the composition as it was (or a rewrite).`;
}

/** The look's layers with each layer the answer left as it was (its composition the same as one of `before`'s)
 * put back as it is stored (`stored`, the look's layers before), so a refinement changes only what it touched. */
export function keepUntouched<L>(stored: readonly L[], before: Composition, after: unknown, layers: L[]): L[] {
  const was = before.layers.map((l) => JSON.stringify(l));
  const now = isObj(after) && Array.isArray(after.layers) ? after.layers : [];
  if (now.length !== layers.length) return layers;
  return layers.map((l, i) => {
    const j = was.indexOf(JSON.stringify(now[i]));
    return j >= 0 && stored[j] ? stored[j]! : l;
  });
}
