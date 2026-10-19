// sketch: the offline generator. Picks one to three library presets or sources by keywords in the idea (each theme
// names the ones it prefers), colour words to the nearest palette and its swatches (sketch-colours.ts) for colour
// params, and place words to the rig's tagged groups (SPEC "Rig"). Deterministic, instant, free.
// Library code is only read as text here (params are parsed with regexes, never evaluated).

import WORDS from './sketch-words.json' with { type: 'json' };
import { cleanText, LIMITS } from '../../shared/schemas/generated.ts';
import type { LibraryEntry, PresetEntry, RigGroup } from '../../shared/schemas/rig.ts';
import { choosePalette, colourParams } from './sketch-colours.ts';

type Pattern = Pick<LibraryEntry, 'name' | 'code'> & Partial<LibraryEntry>;
const isPreset = (p: Pattern): p is Pattern & PresetEntry => p.kind === 'preset' && Array.isArray(p.layers);

// Theme words in the idea → the entries it prefers, else terms looked for in a pattern's name, tags, title and summary;
// colour words → full-strength colours ("colour at full strength"); pace words.
const THEMES = WORDS.themes.map((t) => ({ ...t, words: new Set(t.words.split(' ')), terms: t.terms.split(' ') }));
const COLOURS: Record<string, string> = WORDS.colours;
export const colourOf = (w: string) => COLOURS[w] || (w.endsWith('s') && COLOURS[w.slice(0, -1)]);
const WARM_WHITE = WORDS.warmWhite;
export const [SLOW, FAST, STOP] = [WORDS.slow, WORDS.fast, WORDS.stop].map((w) => new Set(w.split(' ')));
/** A param that sets a pace, by its name. */
export const PACE = /speed|rate|pace|spin/i;

// Place phrases → the tags that find their groups (the first tag the rig uses wins), else group ids and names
// matching `match`. Order matters: longer phrases first, so "main arches" is not also read as "arches".
const zone = (key: string, phrases: string, tags: string[], match: RegExp | null) =>
  ({ key, re: new RegExp(`\\b(${phrases})\\b`, 'g'), tags, match });
const ZONES = [
  zone('main-arches', 'main\\s+arch(es)?|portal|entrance|doorway|gateway', ['arch-main'], /main.?arch/),
  zone('mini-arches', '(mini|small|side)\\s+arch(es)?', ['arch-mini'], /mini.?arch/),
  zone('quad-arches', 'quad\\s+arch(es)?', ['arch-quad'], /quad.?arch/),
  zone('rose', 'rose(\\s+window)?|stained\\s+glass|petals?|window', ['rose', 'window'], /^rose|window/),
  zone('spirelets', 'spirelets?|cones?', ['spirelet'], /spirelet/),
  zone('spires', 'spires?|towers?|steeples?|pinnacles?', ['spire', 'tower'], /spire(?!let)|tower/),
  zone('arches', 'arch(es)?|archways?|vaults?', ['arch'], /arch/),
  zone('canopy', 'canopy|ceiling|roof|overhead', ['canopy'], /canopy/),
  // A bare "wash" is a colour wash (a theme); the wash lights are floods, the ground or the wash lights.
  zone('wash', 'wash\\s+lights?|floods?|floodlights?|ground|floor', ['wash', 'flood'], /wash|flood/),
  zone('all', 'everything|everywhere|whole\\s+(cathedral|thing|building|folly|installation|structure)'
    + '|entire\\s+(cathedral|building|folly|installation|structure)|cathedral', ['all'], null),
];
const SIDES: Record<string, RegExp> = {
  front: /\b(front|facade|façade)\b/g, back: /\b(back|rear)\b/g, left: /\bleft\b/g, right: /\bright\b/g,
};

/** A minimal pattern for when the library is empty: a slow drift between two colours. */
export const BUILTIN_PATTERN: Pattern = {
  name: 'colour-drift',
  title: 'Colour drift',
  summary: 'Two colours drifting slowly across whatever the layer lands on.',
  tags: ['wash', 'gradient', 'calm'],
  code: `// Colour drift: two colours drift slowly across whatever this layer lands on.
const params = {
  speed: { value: 0.15, min: 0, max: 2 },
  color: { value: '#ff6000', type: 'color' },
  color2: { value: '#8000ff', type: 'color' },
};

function pixel(p, t, P) {
  const k = wave(p.ly * 0.7 + p.lz * 0.4 - t * P.speed);
  return mix(P.color, P.color2, smoothstep(0.1, 0.9, k));
}
`,
};

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const words = (text: string) => [...text.matchAll(/[a-z0-9][a-z0-9'-]*/g)]
  .map((m) => ({ w: m[0].replace(/'s$/, ''), at: m.index }));

/** Split into clauses so "fire on the spires and ocean on the arches" pairs each theme with its zone. */
function clauses(text: string) {
  const out: { start: number, end: number }[] = [];
  for (const m of text.matchAll(/[^.;!?\n,]+/g)) {
    let last = 0;
    for (const s of m[0].matchAll(/\s+(?:and|while|with|but|then|plus)\s+/g)) {
      out.push({ start: m.index + last, end: m.index + s.index });
      last = s.index + s[0].length;
    }
    out.push({ start: m.index + last, end: m.index + m[0].length });
  }
  return out;
}

const tokensOf = (p: Pattern) => new Set([p.name, p.title, ...(Array.isArray(p.tags) ? p.tags : [])].join(' ')
  .toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4));

function scorePattern(p: Pattern, terms: string[]) {
  const tags = (Array.isArray(p.tags) ? p.tags : []).map((t) => String(t).toLowerCase());
  const head = `${p.name || ''} ${p.title || ''}`.toLowerCase();
  const summary = String(p.summary || '').toLowerCase();
  let score = 0;
  terms.forEach((term, i) => {
    let s = 0;
    if (tags.includes(term)) s += 4;
    else if (tags.some((t) => t.startsWith(term))) s += 2;
    if (head.includes(term)) s += 2;
    if (summary.includes(term)) s += 1;
    score += i === 0 ? 2 * s : s; // a theme's first term is its main word
  });
  return score;
}

/** Words that name a place, colour or pace: they never pick a pattern by its own name or tags. */
function reserved(w: string) {
  if (colourOf(w) || SLOW.has(w) || FAST.has(w) || STOP.has(w)) return true;
  if (['warm', 'cool', 'cold', 'hot', 'bright', 'dark', 'deep'].includes(w)) return true;
  return [...ZONES.map((z) => z.re), ...Object.values(SIDES)].some((re) => new RegExp(re.source).test(w));
}

/** Read the `params` declaration of a pattern statically. */
type Declared = { type: string, value: unknown, min?: number, max?: number };
export function parseParams(code: string) {
  const out: Record<string, Declared> = {};
  const start = /\b(?:const|let|var)\s+params\s*=\s*\{/.exec(code || '');
  if (!start) return out;
  let end = start.index + start[0].length - 1;
  for (let depth = 0; end < code.length; end++) {
    if (code[end] === '{') depth++;
    else if (code[end] === '}' && --depth === 0) break;
  }
  if (end >= code.length) return out;
  for (const m of code.slice(start.index + start[0].length, end).matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\{([^{}]*)\}/g)) {
    const spec = m[2]!;
    const type = /type\s*:\s*['"](\w+)['"]/.exec(spec)?.[1] || 'number';
    const raw = /value\s*:\s*([^,}\n]+)/.exec(spec)?.[1]?.trim();
    const n = (re: RegExp) => {
      const v = re.exec(spec)?.[1];
      return v != null && Number.isFinite(Number(v)) ? Number(v) : undefined;
    };
    out[m[1]!] = {
      type,
      value: type === 'color' ? raw?.replace(/['"]/g, '') : raw === 'true' || (raw === 'false' ? false : Number(raw)),
      min: n(/min\s*:\s*(-?[\d.]+)/),
      max: n(/max\s*:\s*(-?[\d.]+)/),
    };
  }
  return out;
}

export function groupIndex(groups: readonly RigGroup[]) {
  const byId = new Map(groups.filter((g) => g && typeof g.id === 'string').map((g) => [g.id, g]));
  const depth = (g: RigGroup) => {
    let d = 0;
    for (let p = g.parent, guard = 0; p && byId.has(p) && guard < 32; p = byId.get(p)!.parent, guard++) d++;
    return d;
  };
  const isUnder = (g: RigGroup, ancestor: string) => {
    for (let p = g.parent, guard = 0; p && guard < 32; p = byId.get(p)?.parent, guard++) {
      if (p === ancestor) return true;
    }
    return false;
  };
  const root = [...byId.values()].find((g) => g.parent == null)?.id || 'all';
  const tagged = (tag: string) => [...byId.values()].filter((g) => Array.isArray(g.tags) && g.tags.includes(tag));
  return { byId, depth, isUnder, root, tagged, list: [...byId.values()] };
}

/** { ids, tags }: the shallowest groups with the zone's first tag the rig uses, else whose id or name matches. */
type Zone = (typeof ZONES)[number];
type Groups = ReturnType<typeof groupIndex>;
function findZone(zone: Zone, gi: Groups) {
  const top = (hits: RigGroup[]) => {
    const d = Math.min(...hits.map(gi.depth));
    return hits.filter((g) => gi.depth(g) === d).map((g) => g.id).sort();
  };
  for (const tag of zone.tags) {
    const hits = gi.tagged(tag);
    if (hits.length) return { ids: top(hits), tags: [tag] };
  }
  if (!zone.match) return { ids: [gi.root], tags: zone.tags };
  const named = (g: RigGroup) => String(g.name || '').toLowerCase().replace(/\s+/g, '-');
  const hits = gi.list.filter((g) => zone.match!.test(g.id) || zone.match!.test(named(g)));
  return { ids: hits.length ? top(hits) : [], tags: zone.tags.slice(0, 1) };
}

/** Groups on one side (front/back/left/right), optionally within some zone groups. */
const OPPOSITE: Record<string, string> = { front: 'back', back: 'front', left: 'right', right: 'left' };
function findSide(side: string, gi: Groups, within?: string[]) {
  // Groups tagged with the side; on a rig with no side tags at all, an id naming it (not one naming both sides, as a
  // quad arch's faces do: "quad-back-bottom-left-front"). A rig that tags sides but not this one has no such side.
  const has = (g: RigGroup) => {
    const t = g.id.split(/[^a-z0-9]+/);
    return t.includes(side) && !t.includes(OPPOSITE[side]);
  };
  let hits = gi.tagged(side);
  if (!hits.length && !Object.keys(OPPOSITE).some((s) => gi.tagged(s).length)) hits = gi.list.filter(has);
  if (within) hits = hits.filter((g) => within.some((w) => g.id === w || gi.isUnder(g, w)));
  // Keep the outermost: drop any whose ancestor is also a hit.
  const ids = new Set(hits.map((g) => g.id));
  const outer = hits.filter((g) => !hits.some((h) => h !== g && ids.has(h.id) && gi.isUnder(g, h.id)));
  return outer.map((g) => g.id).sort().slice(0, 8);
}

/** Zone mentions with their positions and resolved group ids. */
type Mention = { key: string, at: number, ids: string[], tags: string[] };
export function zoneMentions(text: string, gi: Groups) {
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
  const out: Mention[] = [];
  for (const zone of ZONES) {
    zone.re.lastIndex = 0;
    let m;
    while ((m = zone.re.exec(text))) {
      const [a, b] = [m.index, m.index + m[0].length];
      if (!free(a, b)) continue;
      taken.push([a, b]);
      let { ids, tags } = findZone(zone, gi);
      // "left spires", "back arches": narrow to that side when the group tree allows it.
      const before = text.slice(Math.max(0, a - 12), a);
      const side = /\b(front|back|rear|left|right)\s+(?:\w+\s+)?$/.exec(before)?.[1];
      if (side && ids.length) {
        const narrowed = findSide(side === 'rear' ? 'back' : side, gi, ids);
        if (narrowed.length) { ids = narrowed; taken.push([a - before.length + before.lastIndexOf(side), a]); }
      }
      if (ids.length) out.push({ key: zone.key, at: a, ids, tags });
    }
  }
  for (const [side, re] of Object.entries(SIDES)) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const [a, b] = [m.index, m.index + m[0].length];
      if (!free(a, b)) continue;
      taken.push([a, b]);
      const ids = findSide(side, gi);
      if (ids.length) out.push({ key: side, at: a, ids, tags: [side] });
    }
  }
  return out.sort((x, y) => x.at - y.at);
}

function makeTitle(text: string) {
  let t = String(text || '').split(/[.!?\n]/).find((s) => s.trim()) || '';
  // A long sentence is cut at its first clause.
  if (t.length > 50) {
    const first = t.split(/[,;:(]|\s[-–—]\s/)[0];
    if (first.trim().length >= 12) t = first;
  }
  t = t
    .trim()
    .replace(new RegExp('^(please\\s+)?(can you\\s+|could you\\s+)?(make|create|show|give|build|design|do|paint|'
      + "imagine|picture|i want|i'd like|i would like|let's have|lets have|how about)\\s+(me\\s+|us\\s+)?", 'i'), '')
    .replace(/^(a|an|the|some)\s+/i, '');
  t = cleanText(t, 60);
  return t ? t[0].toUpperCase() + t.slice(1) : 'Untitled sketch';
}

const colourName = (hex: string) => (hex === WARM_WHITE ? 'warm white'
  : Object.entries(COLOURS).find(([, v]) => v === hex)?.[0]);

/** A look from the idea's words: { title, summary, layers }. */
export function sketchLook({ text = '', library = [], groups = [] }: { text?: string, library?: readonly Pattern[],
  groups?: readonly RigGroup[] } = {}) {
  const raw = String(text).slice(0, 4000);
  const lower = raw.toLowerCase();
  const all = (Array.isArray(library) ? library : []).filter((p) => p && typeof p.name === 'string');
  const modules = new Map(all.filter((p) => !isPreset(p) && typeof p.code === 'string').map((p) => [p.name, p]));
  // Sources, and presets (one-layer chains the generators' limits allow) whose modules the library has.
  const lib = all.filter((p) => (isPreset(p) ? p.layers.length === 1 && p.layers[0]!.modules.length <= LIMITS.modules
    && p.layers[0]!.modules.every((m) => modules.has(m.ref)) : /\bfunction\s+pixel\s*\(/.test(p.code)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const gi = groupIndex(Array.isArray(groups) ? groups : []);
  const ws = words(lower);
  const parts = clauses(lower);
  const clauseOf = (at: number) => parts.findIndex((c) => at >= c.start && at < c.end);
  // Theme hits, in order of appearance; a pattern named or tagged in the idea is a hit too.
  const hits: { at: number, key: string, terms?: string[], use?: string[], direct?: number, weak?: boolean }[] = [];
  const ownTokens = lib.map(tokensOf);
  for (const { w, at } of ws) {
    const weak = THEMES.some((t) => t.weak && t.words.has(w));
    for (const t of THEMES) if (t.words.has(w)) hits.push({ at, terms: t.terms, use: t.use, key: t.key, weak });
    if (w.length < 4 || reserved(w)) continue;
    lib.forEach((p, i) => ownTokens[i].has(w) && hits.push({ at, direct: i, key: p.name, weak }));
  }

  // A weak theme (a plain wash) gives way to any other in its clause.
  hits.sort((a, b) => Number(!!a.weak) - Number(!!b.weak));
  // Choose up to three distinct patterns, one per clause, each remembering its clause.
  type Chosen = { index: number, pattern: Pattern, clause: number, groups: string[], tags: string[] };
  const chosen: Chosen[] = [];
  const seenKeys = new Set<string>();
  for (const hit of hits) {
    if (chosen.length >= 3 || !lib.length) break;
    if (seenKeys.has(hit.key) || chosen.some((c) => c.clause === clauseOf(hit.at))) continue;
    let pick = -1;
    const named = hit.use?.map((n) => lib.findIndex((p) => p.name === n)).find((i) => i >= 0);
    if (hit.direct != null) pick = hit.direct;
    else if (named !== undefined) pick = named;
    else {
      let best = 0;
      lib.forEach((p, i) => {
        const s = scorePattern(p, hit.terms!);
        if (s > best && !chosen.some((c) => c.index === i)) [best, pick] = [s, i];
      });
    }
    if (pick < 0 || chosen.some((c) => c.index === pick)) continue;
    seenKeys.add(hit.key);
    chosen.push({ index: pick, pattern: lib[pick]!, clause: clauseOf(hit.at), groups: [], tags: [] });
  }
  if (!chosen.length) {
    const pattern = lib.length ? lib[hashString(lower.trim()) % lib.length] : BUILTIN_PATTERN;
    chosen.push({ index: -1, pattern: pattern!, clause: -1, groups: [], tags: [] });
  }

  // Zones: a pattern takes the zones named in its own clause; zones named on their own go to a
  // lone pattern; everything else covers the whole rig. Each layer keeps the tags that found its groups.
  const zones = zoneMentions(lower, gi);
  const place = (c: Chosen, list: Mention[]) => {
    c.groups = [...new Set(list.flatMap((z) => z.ids))];
    c.tags = [...new Set(list.flatMap((z) => z.tags))];
  };
  for (const c of chosen) place(c, zones.filter((z) => c.clause >= 0 && clauseOf(z.at) === c.clause));
  const claimed = new Set(chosen.filter((c) => c.clause >= 0).map((c) => c.clause));
  const orphans = zones.filter((z) => !claimed.has(clauseOf(z.at)));
  if (orphans.length && chosen.length === 1 && !chosen[0].groups.length) place(chosen[0], orphans);
  for (const c of chosen) if (!c.groups.length) Object.assign(c, { groups: [gi.root], tags: ['all'] });
  // Whole-rig layers at the bottom, zone accents on top (stable order otherwise).
  const whole = (c: Chosen) => (c.groups.includes(gi.root) ? 1 : 0);
  chosen.sort((a, b) => whole(b) - whole(a));

  // Colours and pace, each with where it was said: a pattern takes those in its own clause,
  // else those said apart from any pattern, else all of them.
  const colourAt: { hex: string, at: number, prev?: string, next?: string }[] = [];
  for (let i = 0; i < ws.length; i++) {
    const { w, at } = ws[i];
    const prev = ws[i - 1]?.w;
    let hex = colourOf(w);
    if (w === 'warm' && ws[i + 1]?.w === 'white') [hex, i] = [WARM_WHITE, i + 1];
    if (hex) colourAt.push({ hex, at, prev, next: ws[i + 1]?.w });
  }
  const paceAt = ws.filter(({ w }) => SLOW.has(w) || FAST.has(w))
    .map(({ w, at }) => ({ f: SLOW.has(w) ? 0.5 : 1.8, at }));
  const patternClauses = new Set(chosen.map((c) => c.clause).filter((c) => c >= 0));
  const scoped = <T extends { at: number }>(list: T[], c: Chosen) => {
    const own = list.filter((x) => c.clause >= 0 && clauseOf(x.at) === c.clause);
    if (own.length) return { list: own, own: true };
    const loose = list.filter((x) => !patternClauses.has(clauseOf(x.at)));
    return { list: loose.length ? loose : chosen.length === 1 ? list : [], own: false };
  };
  const allColours = [...new Set(colourAt.map((c) => c.hex))], palette = choosePalette(allColours);
  const placeOf = (c: Chosen) => c.groups.map((id) => gi.byId.get(id)?.name || id).join(', ');
  const bpm = Number(/(\d{2,3})\s*bpm/.exec(lower)?.[1]) || 0;

  const layers = chosen.map((c, li) => {
    const paces = scoped(paceAt, c).list, pace = paces.length ? paces.at(-1)!.f : 1;
    const { list: mentions, own: here } = scoped(colourAt, c);
    const unique = mentions.filter((m, i) => mentions.findIndex((x) => x.hex === m.hex) === i);
    /** A module's params over those it is given: pace and tempo, and, where `colours`, the colours named. */
    const tune = (code: string, given: Record<string, unknown>, colours: boolean) => {
      const decl = parseParams(code), params: Record<string, unknown> = { ...given };
      for (const [name, d] of Object.entries(decl)) {
        const v = name in given ? given[name] : d.value;
        if (d.type !== 'number' || typeof v !== 'number' || !Number.isFinite(v)) continue;
        if (/bpm|tempo/i.test(name) && bpm) params[name] = clampTo(bpm, d);
        else if (PACE.test(name) && pace !== 1) params[name] = round(clampTo(v * pace, d));
      }
      const names = Object.entries(decl).filter(([, d]) => d.type === 'color').map(([n]) => n);
      return colours ? { ...params, ...colourParams(names, unique, palette, here ? 0 : li) } : params;
    };
    const where = whole(c) ? '' : ` · ${placeOf(c)}`;
    const title = cleanText(`${c.pattern.title || c.pattern.name || 'Pattern'}${where}`, LIMITS.layerTitle);
    const layer = { title, groups: c.groups, tags: c.tags, blend: li === 0 ? 'add' : 'max', level: 1 };
    if (!isPreset(c.pattern)) return { ...layer, params: tune(c.pattern.code, {}, true), code: c.pattern.code };
    // A preset's chain, each module the library's; the colours named go to its top source, the one on show.
    const list = c.pattern.layers[0]!.modules, entry = (m: { ref: string }) => modules.get(m.ref)!;
    let top = list.length - 1;
    while (top > 0 && (entry(list[top]!).kind !== 'source' || list[top]!.as)) top--;
    return { ...layer, modules: list.map((m, k) => ({ id: m.id ?? `m${k + 1}`, kind: entry(m).kind ?? 'source',
      title: entry(m).title || m.ref, ref: m.ref, code: entry(m).code, params: tune(entry(m).code, m.params ?? {},
        k === top), ...(m.blend ? { blend: m.blend } : {}), ...(m.as ? { as: m.as } : {}),
      ...(m.input ? { input: m.input } : {}) })) };
  });

  // An idea placed only on zones gets a calm bed under it, so the rest of the installation is not dark.
  const bed = modules.get('colour-wash');
  if (bed && !chosen.some(whole) && layers.length < LIMITS.layers) {
    layers.unshift({ title: 'Bed', groups: [gi.root], tags: ['all'], blend: 'add', level: 0.35,
      params: { colours: 'low', speed: 0.05 }, code: bed.code });
  }
  const named = allColours.map(colourName).filter(Boolean);
  const what = chosen.map((c) => `${c.pattern.title || c.pattern.name} on ${placeOf(c)}`).join('; ');
  const summary = `Sketched from the pattern library: ${what}${named.length ? `, in ${named.join(', ')}` : ''}. `
    + 'This is a quick keyword match; an AI generator can do much better.';
  return { title: makeTitle(raw), summary: cleanText(summary, LIMITS.summary), layers,
    ...(palette ? { globals: { palette: palette.name } } : {}) };
}

const clampTo = (v: number, d: Declared) => Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, v));
const round = (x: number) => Math.round(x * 1000) / 1000;
