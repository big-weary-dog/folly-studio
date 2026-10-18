// Static checks on a generated look before it is saved: what cannot be used is dropped (with a note), and module
// chains, globals and automation are then held to the API's own rules (src/look-rules.js). Generated code is
// untrusted: it is only inspected here as text, never executed on the server (no eval, no vm, no Function).
import { GLOBALS, macroNameOk, MAX_LANES, MAX_MACROS, MAX_POINTS } from '../../public/js/pattern-core.js';
import { cleanAutomation, cleanBinding, cleanGlobals, PALETTE_NAMES, TAG } from '../look-rules.js';

export const LIMITS = Object.freeze({
  layers: 4, codeBytes: 20 * 1024, title: 80, layerTitle: 80, summary: 400, params: 32, clips: 32, duration: 600,
});
export const BLENDS = Object.freeze(['add', 'over', 'max', 'multiply']);
const BLEND_ALIASES = { maximum: 'max', normal: 'over', mult: 'multiply', screen: 'max', lighten: 'max' };
const DEFINES = (fn) => new RegExp(`\\bfunction\\s+${fn}\\s*\\(`);
const PARAM_NAME = /^[A-Za-z_$][\w$]{0,63}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const FUNCTION = { source: 'pixel', warp: 'warp', filter: 'filter' };
const KIND_ALIASES = { pattern: 'source', effect: 'filter', transform: 'warp' };
export const MAX_GENERATED_MODULES = 6;
// Control characters other than tab/newline/CR; they have no place in code or text we store.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** An error whose `userMessage` is safe to show to the person who submitted the idea. */
export class GenerateError extends Error {
  constructor(userMessage, detail) {
    super(detail ? `${userMessage} (${detail})` : userMessage);
    this.name = 'GenerateError';
    this.userMessage = userMessage;
  }
}

/** Collapse whitespace, drop control characters, and cut to `max` characters at a word boundary. */
export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const s = value.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, '');
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}

/** Strip a Markdown code fence the model may have wrapped round the code. */
function unfence(code) {
  const m = /^\s*(`{3,}|~{3,})[\w-]*[ \t]*\n([\s\S]*?)\n?\1\s*$/.exec(code);
  return m ? m[2] : code;
}

function checkCode(code, fn = 'pixel') {
  if (typeof code !== 'string' || !code.trim()) return { error: 'has no code' };
  const c = unfence(code.replace(/\r\n?/g, '\n')).replace(CONTROL, '');
  if (Buffer.byteLength(c, 'utf8') > LIMITS.codeBytes) return { error: 'code is over 20 kB' };
  if (!DEFINES(fn).test(c)) return { error: `code does not define function ${fn}` };
  return { code: c };
}

/** Known group ids; none: the root, or nothing when tags say where it goes (SPEC "Looks"). */
function checkGroups(groups, known, root, tags) {
  const list = (Array.isArray(groups) ? groups : typeof groups === 'string' ? [groups] : [])
    .filter((g) => typeof g === 'string').map((g) => g.trim()).filter((g) => known.has(g));
  return list.length ? [...new Set(list)] : tags.length ? [] : [root];
}

const checkTags = (tags) => [...new Set((Array.isArray(tags) ? tags : [])
  .filter((t) => typeof t === 'string' && TAG.test(t)))].slice(0, 16);

function checkBlend(blend) {
  const b = typeof blend === 'string' ? blend.trim().toLowerCase() : '';
  return BLENDS.includes(b) ? b : BLEND_ALIASES[b] || 'add';
}

function checkLevel(level) {
  const n = typeof level === 'string' ? Number(level) : level;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

function checkParams(params) {
  const out = {};
  if (!params || typeof params !== 'object' || Array.isArray(params)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(params)) {
    if (n >= LIMITS.params || !PARAM_NAME.test(k) || k === '__proto__') continue;
    if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && HEX.test(v)) out[k] = v.toLowerCase();
    else if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      out[k] = v.map((x) => Math.min(1, Math.max(0, x)));
    } else if (cleanBinding(v)) out[k] = cleanBinding(v);
    else continue;
    n++;
  }
  return out;
}

const ms = (v) => Math.round(v * 1000) / 1000;
const time = (v) => (typeof v === 'string' && v.trim() ? Number(v) : v);
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * A layer's clips as the API stores them: [{ start, end, fadeIn, fadeOut }] seconds within 0..600,
 * end after start, sorted, at most 32. Bad clips, and one that overlaps the clip before it, are
 * dropped (noted). None left: the layer is always on.
 */
function checkClips(clips, note) {
  if (clips == null) return [];
  if (!Array.isArray(clips)) { note('clips is not a list'); return []; }
  const ok = (n) => finite(n) && n >= 0 && n <= LIMITS.duration;
  const fade = (v) => (finite(time(v ?? 0)) ? ms(Math.min(LIMITS.duration, Math.max(0, time(v ?? 0)))) : 0);
  const list = [];
  for (const c of clips) {
    const [start, end] = c && typeof c === 'object' ? [time(c.start), time(c.end)] : [NaN, NaN];
    if (!ok(start) || !ok(end) || !(ms(end) > ms(start))) note('a clip without a valid start and end');
    else list.push({ start: ms(start), end: ms(end), fadeIn: fade(c.fadeIn), fadeOut: fade(c.fadeOut) });
  }
  const out = [];
  for (const c of list.sort((a, b) => a.start - b.start)) {
    if (out.length >= LIMITS.clips) note(`more than ${LIMITS.clips} clips`);
    else if (out.length && c.start < out.at(-1).end) note(`a clip at ${c.start} s overlapping the one before`);
    else out.push(c);
  }
  return out;
}

/**
 * Validate and normalise a generator's output, `{ title, summary, duration?, globals?, automation?, layers: [{
 * title, groups, tags?, blend, level, clips?, code + params? | modules }] }`, against the rig's groups (from
 * loadRig) and the library (a module's `ref`). → { title, summary, duration?, layers, globals?, automation?,
 * dropped: [why each dropped thing went] }
 */
export function validateLook(look, { groups = [], library = [] } = {}) {
  if (!look || typeof look !== 'object' || Array.isArray(look)) {
    throw new GenerateError('The generator returned something that is not a look.');
  }
  const known = new Set((groups || []).map((g) => g && g.id).filter((id) => typeof id === 'string'));
  const root = (groups || []).find((g) => g && g.parent == null)?.id || 'all';
  const layers = [];
  const dropped = [];
  for (const [i, layer] of (Array.isArray(look.layers) ? look.layers : []).entries()) {
    const drop = (why) => dropped.push(`layer ${i + 1}: ${why}`);
    if (layers.length >= LIMITS.layers) { drop(`more than ${LIMITS.layers} layers`); continue; }
    if (!layer || typeof layer !== 'object') { drop('not an object'); continue; }
    // A chain of modules, or one pattern's code (and params).
    let own;
    if (Array.isArray(layer.modules) && layer.modules.length) {
      const modules = checkModules(layer.modules, library, drop);
      if (!modules) { drop('no usable source module'); continue; }
      own = { modules };
    } else {
      const { code, error } = checkCode(layer.code);
      if (error) { drop(error); continue; }
      own = { code, params: checkParams(layer.params) };
    }
    const n = layers.length + 1;
    const clips = checkClips(layer.clips, drop);
    const tags = checkTags(layer.tags);
    layers.push({
      id: `l${n}`, title: cleanText(layer.title, LIMITS.layerTitle) || `Layer ${n}`, ...own,
      groups: checkGroups(layer.groups, known, root, tags), ...(tags.length ? { tags } : {}),
      blend: checkBlend(layer.blend), level: checkLevel(layer.level),
      ...(clips.length ? { clips } : {}),
    });
  }
  if (!layers.length) {
    const why = dropped.length ? dropped[0].replace(/^layer \d+: /, '') : 'no layers';
    throw new GenerateError('The generator did not produce a usable pattern.', why);
  }
  const d = time(look.duration); // the look's length in seconds (1..600), or the default (30)
  const note = (why) => dropped.push(why);
  const globals = checkGlobals(look.globals, note);
  const automation = look.automation == null ? undefined : checkAutomation(look.automation, globals, note);
  return {
    title: cleanText(look.title, LIMITS.title) || 'Untitled look',
    summary: cleanText(look.summary, LIMITS.summary),
    ...(finite(d) ? { duration: ms(Math.min(LIMITS.duration, Math.max(1, d))) } : {}),
    layers,
    ...(globals ? { globals } : {}),
    ...(automation ? { automation } : {}),
    dropped,
  };
}

/** Modules [{ kind, title, code, ref?, params?, input?, as?, blend?, id? }] → the chain as stored; null: no source. */
function checkModules(modules, library, drop) {
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
    out.push({ id, kind, title: cleanText(m.title, LIMITS.layerTitle) || ref || kind, ...(ref ? { ref } : {}), code,
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
function checkGlobals(g, drop) {
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
  return strict('globals', () => cleanGlobals(out), out, drop);
}

/** Automation as a list of { name, points } or a map → stored lanes (sorted, one point per time), or undefined. */
function checkAutomation(a, globals, drop) {
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
  return strict('automation', () => cleanAutomation(out, globals), out, drop);
}

/** clean(), the API's rule, on what was kept: undefined when nothing was, or (noted) when the rule refuses it. */
function strict(what, clean, kept, drop) {
  if (!Object.keys(kept).length) return undefined;
  try { return clean(); } catch (e) { drop(`${what}: ${e.message}`); return undefined; }
}
