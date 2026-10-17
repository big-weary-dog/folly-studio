// Static checks on a generated look before it is saved. Generated code is untrusted: it is only
// inspected here as text, never executed on the server (no eval, no vm, no Function).
import { cleanBinding } from '../look-rules.js';
import { checkAutomation, checkGlobals, checkModules } from './validate-chain.js';

export const LIMITS = Object.freeze({
  layers: 4, codeBytes: 20 * 1024, title: 80, layerTitle: 80, summary: 400, params: 32, clips: 32, duration: 600,
});
export const BLENDS = Object.freeze(['add', 'over', 'max', 'multiply']);
const BLEND_ALIASES = { maximum: 'max', normal: 'over', mult: 'multiply', screen: 'max', lighten: 'max' };
const DEFINES = (fn) => new RegExp(`\\bfunction\\s+${fn}\\s*\\(`);
const PARAM_NAME = /^[A-Za-z_$][\w$]{0,63}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
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

function checkGroups(groups, known) {
  const list = (Array.isArray(groups) ? groups : typeof groups === 'string' ? [groups] : [])
    .filter((g) => typeof g === 'string').map((g) => g.trim()).filter((g) => known.has(g));
  return list.length ? [...new Set(list)] : ['cathedral'];
}

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

/**
 * A layer's clips as the API stores them: [{ start, end, fadeIn, fadeOut }] seconds within 0..600,
 * end after start, sorted, at most 32. Bad clips, and one that overlaps the clip before it, are
 * dropped (noted). None left: the layer is always on.
 */
function checkClips(clips, note) {
  if (clips == null) return [];
  if (!Array.isArray(clips)) {
    note('clips is not a list');
    return [];
  }
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
 * title, groups, blend, level, clips?, code + params? | modules }] }`, against the cathedral's groups (from
 * loadGroups) and the library (a module's `ref`). → { title, summary, duration?, layers, globals?, automation?,
 * dropped: [why each dropped thing went] }
 */
export function validateLook(look, { groups = [], library = [] } = {}) {
  if (!look || typeof look !== 'object' || Array.isArray(look)) {
    throw new GenerateError('The generator returned something that is not a look.');
  }
  const known = new Set(['cathedral', ...(groups || []).map((g) => g && g.id).filter((id) => typeof id === 'string')]);
  const layers = [];
  const dropped = [];
  for (const [i, layer] of (Array.isArray(look.layers) ? look.layers : []).entries()) {
    const drop = (why) => dropped.push(`layer ${i + 1}: ${why}`);
    if (layers.length >= LIMITS.layers) { drop(`more than ${LIMITS.layers} layers`); continue; }
    if (!layer || typeof layer !== 'object') { drop('not an object'); continue; }
    // A chain of modules, or one pattern's code (and params).
    let own;
    if (Array.isArray(layer.modules) && layer.modules.length) {
      const modules = checkModules(layer.modules, { checkCode, checkParams, checkBlend, library, drop,
        cleanTitle: (t) => cleanText(t, LIMITS.layerTitle) });
      if (!modules) { drop('no usable source module'); continue; }
      own = { modules };
    } else {
      const { code, error } = checkCode(layer.code);
      if (error) { drop(error); continue; }
      own = { code, params: checkParams(layer.params) };
    }
    const n = layers.length + 1;
    const clips = checkClips(layer.clips, drop);
    layers.push({
      id: `l${n}`, title: cleanText(layer.title, LIMITS.layerTitle) || `Layer ${n}`, ...own,
      groups: checkGroups(layer.groups, known), blend: checkBlend(layer.blend), level: checkLevel(layer.level),
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
