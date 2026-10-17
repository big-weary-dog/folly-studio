// Static checks on a generated look before it is saved. Generated code is untrusted: it is only
// inspected here as text, never executed on the server (no eval, no vm, no Function).

export const LIMITS = Object.freeze({
  layers: 4,
  codeBytes: 20 * 1024,
  title: 80,
  layerTitle: 80,
  summary: 400,
  params: 32,
  clips: 32,
  duration: 600,
});
export const BLENDS = Object.freeze(['add', 'over', 'max', 'multiply']);
const BLEND_ALIASES = { maximum: 'max', normal: 'over', mult: 'multiply', screen: 'max', lighten: 'max' };
const PIXEL_FN = /\bfunction\s+pixel\s*\(/;
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

function checkCode(code) {
  if (typeof code !== 'string' || !code.trim()) return { error: 'has no code' };
  const c = unfence(code.replace(/\r\n?/g, '\n')).replace(CONTROL, '');
  if (Buffer.byteLength(c, 'utf8') > LIMITS.codeBytes) return { error: 'code is over 20 kB' };
  if (!PIXEL_FN.test(c)) return { error: 'code does not define function pixel' };
  return { code: c };
}

function checkGroups(groups, known) {
  const list = (Array.isArray(groups) ? groups : typeof groups === 'string' ? [groups] : [])
    .filter((g) => typeof g === 'string')
    .map((g) => g.trim());
  const out = [];
  for (const g of list) if (known.has(g) && !out.includes(g)) out.push(g);
  return out.length ? out : ['cathedral'];
}

function checkBlend(blend) {
  if (typeof blend !== 'string') return 'add';
  const b = blend.trim().toLowerCase();
  if (BLENDS.includes(b)) return b;
  return BLEND_ALIASES[b] || 'add';
}

function checkLevel(level) {
  const n = typeof level === 'string' ? Number(level) : level;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

function checkParams(params) {
  const out = {};
  if (!params || typeof params !== 'object' || Array.isArray(params)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(params)) {
    if (n >= LIMITS.params || !PARAM_NAME.test(k) || k === '__proto__') continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && HEX.test(v)) out[k] = v.toLowerCase();
    else if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)))
      out[k] = v.map((x) => Math.min(1, Math.max(0, x)));
    else continue;
    n++;
  }
  return out;
}

const ms = (v) => Math.round(v * 1000) / 1000;
const time = (v) => (typeof v === 'string' && v.trim() ? Number(v) : v);

/**
 * A layer's clips as the API stores them: [{ start, end, fadeIn, fadeOut }] seconds within
 * 0..600, end after start, sorted, at most 32. Bad clips, and one that overlaps the clip
 * before it, are dropped (noted in `dropped`). None left: the layer is always on.
 */
function checkClips(clips, note) {
  if (clips == null) return [];
  if (!Array.isArray(clips)) {
    note('clips is not a list');
    return [];
  }
  const list = [];
  for (const c of clips) {
    const start = c && typeof c === 'object' ? time(c.start) : NaN;
    const end = c && typeof c === 'object' ? time(c.end) : NaN;
    const fade = (v) => {
      const n = time(v ?? 0);
      return typeof n === 'number' && Number.isFinite(n) ? ms(Math.min(LIMITS.duration, Math.max(0, n))) : 0;
    };
    const ok = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= LIMITS.duration;
    if (!ok(start) || !ok(end) || !(ms(end) > ms(start))) {
      note('a clip without a valid start and end');
      continue;
    }
    list.push({ start: ms(start), end: ms(end), fadeIn: fade(c.fadeIn), fadeOut: fade(c.fadeOut) });
  }
  list.sort((a, b) => a.start - b.start);
  const out = [];
  for (const c of list) {
    if (out.length >= LIMITS.clips) note(`more than ${LIMITS.clips} clips`);
    else if (out.length && c.start < out[out.length - 1].end) note(`a clip at ${c.start} s overlapping the one before`);
    else out.push(c);
  }
  return out;
}

/** The look's length in seconds (1..600), or undefined for the default (30). */
function checkDuration(d) {
  const n = time(d);
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return ms(Math.min(LIMITS.duration, Math.max(1, n)));
}

/**
 * Validate and normalise a generator's output.
 * @param {unknown} look
 *   `{ title, summary, duration?, layers: [{ title, groups, blend, level, params?, clips?, code }] }`
 * @param {{ groups?: Array<{id: string}> }} ctx the cathedral group list (from loadGroups)
 * @returns {{ title: string, summary: string, duration?: number, layers: object[], dropped: string[] }}
 */
export function validateLook(look, { groups = [] } = {}) {
  if (!look || typeof look !== 'object' || Array.isArray(look)) {
    throw new GenerateError('The generator returned something that is not a look.');
  }
  const known = new Set((groups || []).map((g) => g && g.id).filter((id) => typeof id === 'string'));
  known.add('cathedral');
  const raw = Array.isArray(look.layers) ? look.layers : [];
  const layers = [];
  const dropped = [];
  for (const [i, layer] of raw.entries()) {
    if (layers.length >= LIMITS.layers) {
      dropped.push(`layer ${i + 1}: more than ${LIMITS.layers} layers`);
      continue;
    }
    if (!layer || typeof layer !== 'object') {
      dropped.push(`layer ${i + 1}: not an object`);
      continue;
    }
    const { code, error } = checkCode(layer.code);
    if (error) {
      dropped.push(`layer ${i + 1}: ${error}`);
      continue;
    }
    const n = layers.length + 1;
    const clips = checkClips(layer.clips, (why) => dropped.push(`layer ${i + 1}: ${why}`));
    layers.push({
      id: `l${n}`,
      title: cleanText(layer.title, LIMITS.layerTitle) || `Layer ${n}`,
      code,
      groups: checkGroups(layer.groups, known),
      blend: checkBlend(layer.blend),
      level: checkLevel(layer.level),
      params: checkParams(layer.params),
      ...(clips.length ? { clips } : {}),
    });
  }
  if (!layers.length) {
    const why = dropped.length ? dropped[0].replace(/^layer \d+: /, '') : 'no layers';
    throw new GenerateError('The generator did not produce a usable pattern.', why);
  }
  const duration = checkDuration(look.duration);
  return {
    title: cleanText(look.title, LIMITS.title) || 'Untitled look',
    summary: cleanText(look.summary, LIMITS.summary),
    ...(duration !== undefined ? { duration } : {}),
    layers,
    dropped,
  };
}
