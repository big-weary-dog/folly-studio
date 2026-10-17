// sketch: the offline generator. Picks one to three library patterns by keywords in the idea,
// maps colour words to colour params and zone words to groups. Deterministic, instant, free.
// Library code is only read as text here (params are parsed with regexes, never evaluated).

import { cleanText, LIMITS } from './validate.js';

// Theme words in the idea → terms looked for in a pattern's name, tags, title and summary.
const THEMES = [
  { key: 'fire', words: 'fire fires fiery ember embers flame flames flaming burn burning blaze blazing inferno lava molten candle candles phoenix bonfire torch', terms: 'fire ember flame burn lava heat spark' },
  { key: 'water', words: 'ocean oceans sea seas wave waves wavy water tide tides surf underwater reef coral river lake aqua swell ripple ripples rippling deep', terms: 'ocean sea wave water ripple tide swell reef' },
  { key: 'rain', words: 'rain raining rainfall drizzle storm meteor meteors shooting falling drip drips drops droplets comet comets', terms: 'rain meteor shooting fall drip comet drop' },
  { key: 'stars', words: 'star stars starry starlight twinkle twinkling night galaxy cosmos cosmic sparkle sparkles sparkling glitter firefly fireflies constellation constellations space', terms: 'star twinkle sparkle night glitter firefly' },
  { key: 'pulse', words: 'heart hearts heartbeat pulse pulses pulsing beat beats bpm throb throbbing breathe breathing breath techno music bass drum drums rave dance dancing', terms: 'heart pulse beat bpm breath throb' },
  { key: 'spiral', words: 'spiral spirals swirl swirls swirling tornado vortex whirl whirlpool spin spinning twist twisting hypnotic kaleidoscope', terms: 'spiral swirl vortex spin twist kaleidoscope rotate' },
  { key: 'sky', words: 'aurora auroras borealis northern cloud clouds cloudy sky skies mist misty fog foggy haze smoke dream dreamy ethereal nebula', terms: 'aurora cloud sky mist fog nebula noise' },
  { key: 'rainbow', words: 'rainbow rainbows prism prismatic spectrum pride colorful colourful psychedelic hue hues unicorn', terms: 'rainbow prism spectrum hue' },
  { key: 'rose', words: 'rose petal petals flower flowers bloom blooming blossom blossoms mandala stained glass', terms: 'rose petal window bloom flower mandala' },
  { key: 'beam', words: 'lighthouse beam beams searchlight searchlights spotlight sweep sweeping scan scanning radar laser lasers', terms: 'lighthouse beam searchlight sweep scan radar' },
  { key: 'lightning', words: 'lightning thunder electric electricity spark sparks zap plasma', terms: 'lightning electric spark plasma strike' },
  { key: 'dawn', words: 'sunrise sunset dawn dusk sun sunny twilight horizon', terms: 'sunrise sunset dawn gradient wash fade horizon' },
  { key: 'chase', words: 'chase chasing race racing climb climbing rising rise ascend ascending running dart darting darts streak streaking zip zipping swim swimming fish', terms: 'chase rise climb run meteor ember' },
].map((t) => ({ ...t, words: new Set(t.words.split(' ')), terms: t.terms.split(' ') }));

// Colour words → full-strength colours ("colour at full strength").
const COLOURS = {
  red: '#ff0000', crimson: '#ff0020', scarlet: '#ff2000', ruby: '#ff0040', cherry: '#ff0030',
  orange: '#ff6000', amber: '#ff9000', tangerine: '#ff7000', copper: '#ff5a10',
  gold: '#ffb000', golden: '#ffb000', yellow: '#ffe000', lemon: '#f0ff00',
  lime: '#a0ff00', green: '#00ff30', emerald: '#00ff70', jade: '#00ff90', mint: '#40ffb0',
  teal: '#00ffc0', turquoise: '#00ffd8', aqua: '#00ffff', cyan: '#00e8ff',
  blue: '#0040ff', azure: '#0090ff', sapphire: '#0028ff', navy: '#0010ff', cobalt: '#0048ff',
  indigo: '#3000ff', purple: '#8000ff', violet: '#9800ff', lavender: '#b080ff', lilac: '#c070ff',
  magenta: '#ff00c0', fuchsia: '#ff00a0', pink: '#ff2a90', coral: '#ff4050', salmon: '#ff5a40',
  white: '#ffffff', silver: '#c8d8ff', ice: '#a0e8ff', icy: '#a0e8ff',
};
const WARM_WHITE = '#ffc070';
const SLOW = new Set('slow slowly calm calming gentle gently lazy peaceful serene meditative drift drifting soft softly languid sleepy'.split(' '));
const FAST = new Set('fast quick quickly frantic wild energetic rapid racing hyper intense frenzy frenzied manic explosive'.split(' '));
const STOP = new Set('with that this from into onto over under their there then than they them have will would like make show some more most very just also really across around along about light lights look looks pattern patterns color colour colors colours'.split(' '));

// Zone phrases → how to find the groups (matched against group ids and names). Order matters:
// longer phrases first, so "main arches" is not also read as "arches".
const ZONES = [
  { key: 'main-arches', re: /\b(main\s+arch(es)?|portal|entrance|doorway|gateway)\b/g, ids: ['main-arches', 'main-arch'], match: /main.?arch/ },
  { key: 'mini-arches', re: /\b(mini\s+arch(es)?|small\s+arch(es)?|side\s+arch(es)?)\b/g, ids: ['mini-arches'], match: /mini.?arch/ },
  { key: 'quad-arches', re: /\bquad\s+arch(es)?\b/g, ids: ['quad-arches'], match: /quad.?arch/ },
  { key: 'rose', re: /\b(rose(\s+window)?|stained\s+glass|petals?|window)\b/g, ids: ['rose-window', 'rose'], match: /^rose/ },
  { key: 'spirelets', re: /\b(spirelets?|cones?)\b/g, ids: ['spirelets', 'spirelet'], match: /spirelet/ },
  { key: 'spires', re: /\b(spires?|towers?|steeples?|pinnacles?)\b/g, ids: ['spires'], match: /spire(?!let)/ },
  { key: 'arches', re: /\b(arch(es)?|archways?|vaults?)\b/g, ids: ['arches'], match: /arch/ },
  { key: 'canopy', re: /\b(canopy|ceiling|roof|overhead)\b/g, ids: ['canopy'], match: /canopy/ },
  { key: 'wash', re: /\b(wash|floods?|floodlights?|ground|floor)\b/g, ids: ['wash'], match: /wash|flood/ },
  { key: 'cathedral', re: /\b(everything|everywhere|whole\s+(cathedral|thing|building|folly)|entire\s+(cathedral|building|folly)|cathedral)\b/g, ids: ['cathedral'], match: /^cathedral$/ },
];
const SIDES = { front: /\b(front|facade|façade)\b/g, back: /\b(back|rear)\b/g, left: /\bleft\b/g, right: /\bright\b/g };

/** A minimal pattern for when the library is empty: a slow drift between two colours. */
export const BUILTIN_PATTERN = {
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

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function words(text) {
  const out = [];
  const re = /[a-z0-9][a-z0-9'-]*/g;
  let m;
  while ((m = re.exec(text))) out.push({ w: m[0].replace(/'s$/, ''), at: m.index });
  return out;
}

/** Split into clauses so "fire on the spires and ocean on the arches" pairs each theme with its zone. */
function clauses(text) {
  const out = [];
  const re = /[^.;!?\n,]+/g;
  let m;
  while ((m = re.exec(text))) {
    const part = m[0];
    const sub = /\s+(?:and|while|with|but|then|plus)\s+/g;
    let last = 0;
    let s;
    while ((s = sub.exec(part))) {
      out.push({ start: m.index + last, end: m.index + s.index });
      last = s.index + s[0].length;
    }
    out.push({ start: m.index + last, end: m.index + part.length });
  }
  return out;
}

const tokensOf = (p) =>
  new Set(
    [p.name, p.title, ...(Array.isArray(p.tags) ? p.tags : [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4),
  );

function scorePattern(p, terms) {
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
function reserved(w) {
  if (COLOURS[w] || (w.endsWith('s') && COLOURS[w.slice(0, -1)]) || SLOW.has(w) || FAST.has(w) || STOP.has(w)) return true;
  if (['warm', 'cool', 'cold', 'hot', 'bright', 'dark', 'deep'].includes(w)) return true;
  return [...ZONES.map((z) => z.re), ...Object.values(SIDES)].some((re) => new RegExp(re.source).test(w));
}

/** Read the `params` declaration of a pattern statically. */
export function parseParams(code) {
  const out = {};
  const start = /\b(?:const|let|var)\s+params\s*=\s*\{/.exec(code || '');
  if (!start) return out;
  let depth = 0;
  let end = -1;
  for (let i = start.index + start[0].length - 1; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return out;
  const body = code.slice(start.index + start[0].length, end);
  const entry = /([A-Za-z_$][\w$]*)\s*:\s*\{([^{}]*)\}/g;
  let m;
  while ((m = entry.exec(body))) {
    const spec = m[2];
    const type = /type\s*:\s*['"](\w+)['"]/.exec(spec)?.[1] || 'number';
    const raw = /value\s*:\s*([^,}\n]+)/.exec(spec)?.[1]?.trim();
    const n = (re) => {
      const v = re.exec(spec)?.[1];
      return v != null && Number.isFinite(Number(v)) ? Number(v) : undefined;
    };
    out[m[1]] = {
      type,
      value: type === 'color' ? raw?.replace(/['"]/g, '') : raw === 'true' ? true : raw === 'false' ? false : Number(raw),
      min: n(/min\s*:\s*(-?[\d.]+)/),
      max: n(/max\s*:\s*(-?[\d.]+)/),
    };
  }
  return out;
}

// --- groups -------------------------------------------------------------------------------

function groupIndex(groups) {
  const byId = new Map(groups.filter((g) => g && typeof g.id === 'string').map((g) => [g.id, g]));
  const depth = (g) => {
    let d = 0;
    for (let p = g.parent, guard = 0; p && byId.has(p) && guard < 32; p = byId.get(p).parent, guard++) d++;
    return d;
  };
  const isUnder = (g, ancestor) => {
    for (let p = g.parent, guard = 0; p && guard < 32; p = byId.get(p)?.parent, guard++) if (p === ancestor) return true;
    return false;
  };
  return { byId, depth, isUnder, list: [...byId.values()] };
}

/** The shallowest groups whose id (or name) matches; deterministic. */
function findZone(zone, gi) {
  for (const id of zone.ids) if (gi.byId.has(id)) return [id];
  const hits = gi.list.filter((g) => zone.match.test(g.id) || zone.match.test(String(g.name || '').toLowerCase().replace(/\s+/g, '-')));
  if (!hits.length) return [];
  const top = Math.min(...hits.map(gi.depth));
  return hits.filter((g) => gi.depth(g) === top).map((g) => g.id).sort();
}

/** Groups on one side (front/back/left/right), optionally within some zone groups. */
const OPPOSITE = { front: 'back', back: 'front', left: 'right', right: 'left' };
function findSide(side, gi, within) {
  // An id naming both sides (a quad arch's faces: "quad-back-bottom-left-front") is not on one side.
  const has = (g) => {
    const t = g.id.split(/[^a-z0-9]+/);
    return t.includes(side) && !t.includes(OPPOSITE[side]);
  };
  let hits = gi.list.filter(has);
  if (within) hits = hits.filter((g) => within.some((w) => g.id === w || gi.isUnder(g, w)));
  // Keep the outermost: drop any whose ancestor is also a hit.
  const ids = new Set(hits.map((g) => g.id));
  return hits.filter((g) => !hits.some((h) => h !== g && ids.has(h.id) && gi.isUnder(g, h.id))).map((g) => g.id).sort().slice(0, 8);
}

/** Zone mentions with their positions and resolved group ids. */
function zoneMentions(text, gi) {
  const taken = [];
  const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
  const out = [];
  for (const zone of ZONES) {
    zone.re.lastIndex = 0;
    let m;
    while ((m = zone.re.exec(text))) {
      const [a, b] = [m.index, m.index + m[0].length];
      if (!free(a, b)) continue;
      taken.push([a, b]);
      let ids = findZone(zone, gi);
      // "left spires", "back arches": narrow to that side when the group tree allows it.
      const before = text.slice(Math.max(0, a - 12), a);
      const side = /\b(front|back|rear|left|right)\s+(?:\w+\s+)?$/.exec(before)?.[1];
      if (side && ids.length) {
        const narrowed = findSide(side === 'rear' ? 'back' : side, gi, ids);
        if (narrowed.length) {
          ids = narrowed;
          taken.push([a - before.length + before.lastIndexOf(side), a]);
        }
      }
      if (ids.length) out.push({ key: zone.key, at: a, ids });
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
      if (ids.length) out.push({ key: side, at: a, ids });
    }
  }
  return out.sort((x, y) => x.at - y.at);
}

// --- the generator -------------------------------------------------------------------------

function makeTitle(text) {
  let t = String(text || '').split(/[.!?\n]/).find((s) => s.trim()) || '';
  // A long sentence is cut at its first clause.
  if (t.length > 50) {
    const first = t.split(/[,;:(]|\s[-–—]\s/)[0];
    if (first.trim().length >= 12) t = first;
  }
  t = t
    .trim()
    .replace(/^(please\s+)?(can you\s+|could you\s+)?(make|create|show|give|build|design|do|paint|imagine|picture|i want|i'd like|i would like|let's have|lets have|how about)\s+(me\s+|us\s+)?/i, '')
    .replace(/^(a|an|the|some)\s+/i, '');
  t = cleanText(t, 60);
  return t ? t[0].toUpperCase() + t.slice(1) : 'Untitled sketch';
}

const colourName = (hex) => (hex === WARM_WHITE ? 'warm white' : Object.entries(COLOURS).find(([, v]) => v === hex)?.[0]);

/**
 * @param {{ text: string, library?: object[], groups?: object[] }} args
 * @returns {{ title: string, summary: string, layers: object[] }}
 */
export function sketchLook({ text = '', library = [], groups = [] } = {}) {
  const raw = String(text).slice(0, 4000);
  const lower = raw.toLowerCase();
  const lib = (Array.isArray(library) ? library : [])
    .filter((p) => p && typeof p.code === 'string' && /\bfunction\s+pixel\s*\(/.test(p.code))
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const gi = groupIndex(Array.isArray(groups) ? groups : []);
  const ws = words(lower);
  const parts = clauses(lower);
  const clauseOf = (at) => parts.findIndex((c) => at >= c.start && at < c.end);

  // Theme hits, in order of appearance; a pattern named or tagged in the idea is a hit too.
  const hits = [];
  const ownTokens = lib.map(tokensOf);
  for (const { w, at } of ws) {
    for (const theme of THEMES) if (theme.words.has(w)) hits.push({ at, terms: theme.terms, key: theme.key });
    if (w.length >= 4 && !reserved(w)) lib.forEach((p, i) => ownTokens[i].has(w) && hits.push({ at, direct: i, key: p.name }));
  }

  // Choose up to three distinct patterns, one per clause, each remembering its clause.
  const chosen = [];
  const seenKeys = new Set();
  for (const hit of hits) {
    if (chosen.length >= 3 || !lib.length) break;
    if (seenKeys.has(hit.key) || chosen.some((c) => c.clause === clauseOf(hit.at))) continue;
    let pick = -1;
    if (hit.direct != null) pick = hit.direct;
    else {
      let best = 0;
      lib.forEach((p, i) => {
        const s = scorePattern(p, hit.terms);
        if (s > best && !chosen.some((c) => c.index === i)) [best, pick] = [s, i];
      });
    }
    if (pick < 0 || chosen.some((c) => c.index === pick)) continue;
    seenKeys.add(hit.key);
    chosen.push({ index: pick, pattern: lib[pick], clause: clauseOf(hit.at) });
  }
  if (!chosen.length) {
    const pattern = lib.length ? lib[hashString(lower.trim()) % lib.length] : BUILTIN_PATTERN;
    chosen.push({ index: -1, pattern, clause: -1 });
  }

  // Zones: a pattern takes the zones named in its own clause; zones named on their own go to a
  // lone pattern; everything else covers the whole cathedral.
  const zones = zoneMentions(lower, gi);
  for (const c of chosen) {
    const mine = zones.filter((z) => c.clause >= 0 && clauseOf(z.at) === c.clause);
    c.groups = [...new Set(mine.flatMap((z) => z.ids))];
  }
  const claimed = new Set(chosen.filter((c) => c.clause >= 0).map((c) => c.clause));
  const orphans = zones.filter((z) => !claimed.has(clauseOf(z.at)));
  if (orphans.length && chosen.length === 1 && !chosen[0].groups.length) chosen[0].groups = [...new Set(orphans.flatMap((z) => z.ids))];
  for (const c of chosen) if (!c.groups.length) c.groups = ['cathedral'];
  // Whole-cathedral layers at the bottom, zone accents on top (stable order otherwise).
  chosen.sort((a, b) => (b.groups.includes('cathedral') ? 1 : 0) - (a.groups.includes('cathedral') ? 1 : 0));

  // Colours and pace, each with where it was said: a pattern takes those in its own clause,
  // else those said apart from any pattern, else all of them.
  const colourAt = [];
  for (let i = 0; i < ws.length; i++) {
    const { w, at } = ws[i];
    const prev = ws[i - 1]?.w;
    let hex = COLOURS[w] || (w.endsWith('s') && COLOURS[w.slice(0, -1)]);
    if (w === 'warm' && ws[i + 1]?.w === 'white') [hex, i] = [WARM_WHITE, i + 1];
    if (hex) colourAt.push({ hex, at, prev, next: ws[i + 1]?.w });
  }
  const paceAt = ws.filter(({ w }) => SLOW.has(w) || FAST.has(w)).map(({ w, at }) => ({ f: SLOW.has(w) ? 0.5 : 1.8, at }));
  const patternClauses = new Set(chosen.map((c) => c.clause).filter((c) => c >= 0));
  const scoped = (list, c) => {
    const own = list.filter((x) => c.clause >= 0 && clauseOf(x.at) === c.clause);
    if (own.length) return { list: own, own: true };
    const loose = list.filter((x) => !patternClauses.has(clauseOf(x.at)));
    return { list: loose.length ? loose : chosen.length === 1 ? list : [], own: false };
  };
  const allColours = [...new Set(colourAt.map((c) => c.hex))];
  const bpm = Number(/(\d{2,3})\s*bpm/.exec(lower)?.[1]) || 0;

  const layers = chosen.map((c, li) => {
    const decl = parseParams(c.pattern.code);
    const params = {};
    const paces = scoped(paceAt, c).list;
    const pace = paces.length ? paces[paces.length - 1].f : 1;
    for (const [name, d] of Object.entries(decl)) {
      if (d.type !== 'number' || !Number.isFinite(d.value)) continue;
      if (/bpm|tempo/i.test(name) && bpm) params[name] = clampTo(bpm, d);
      else if (/speed|rate|pace/i.test(name) && pace !== 1) params[name] = round(clampTo(d.value * pace, d));
    }
    // Colours: one named next to a param ("white beam", "navy sky") goes there; one set "on" or
    // "over" something goes to a background param; the rest fill the remaining colour params in
    // order, only as many as there are colours, so the pattern keeps its contrast.
    const { list: mentions, own } = scoped(colourAt, c);
    const unique = mentions.filter((m, i) => mentions.findIndex((x) => x.hex === m.hex) === i);
    const free = Object.entries(decl).filter(([, d]) => d.type === 'color').map(([n]) => n);
    const take = (pred) => {
      const i = free.findIndex(pred);
      return i < 0 ? null : free.splice(i, 1)[0];
    };
    const rest = [];
    for (const m of unique) {
      const near = (n) => {
        const a = n.toLowerCase();
        const b = String(m.next || '').replace(/s$/, '');
        return b.length >= 3 && (a === b || a.startsWith(b) || b.startsWith(a));
      };
      const bg = (n) => /^(base|bg|back|sky|sea|low|bed|ground|dark|night|deep)/i.test(n);
      const name = take(near) || (/^(on|over|against|behind|into)$/.test(m.prev || '') || /^(background|backdrop|sky|base|bed)$/.test(m.next || '') ? take(bg) : null);
      if (name) params[name] = m.hex;
      else rest.push(m.hex);
    }
    const shift = own ? 0 : li;
    for (let k = 0; k < rest.length && free.length; k++) params[free.shift()] = rest[(k + shift) % rest.length];
    const where = c.groups.includes('cathedral') ? '' : ` · ${c.groups.map((id) => gi.byId.get(id)?.name || id).join(', ')}`;
    return {
      title: cleanText(`${c.pattern.title || c.pattern.name || 'Pattern'}${where}`, LIMITS.layerTitle),
      groups: c.groups,
      blend: li === 0 ? 'add' : 'max',
      level: 1,
      params,
      code: c.pattern.code,
      _where: c.groups.map((id) => gi.byId.get(id)?.name || id).join(', '),
      _name: c.pattern.title || c.pattern.name,
    };
  });

  const named = allColours.map(colourName).filter(Boolean);
  const parts2 = layers.map((l) => `${l._name} on ${l._where}`);
  const summary =
    `Sketched from the pattern library: ${parts2.join('; ')}` +
    (named.length ? `, in ${named.join(', ')}` : '') +
    '. This is a quick keyword match; an AI generator can do much better.';
  for (const l of layers) {
    delete l._where;
    delete l._name;
  }
  return { title: makeTitle(raw), summary: cleanText(summary, LIMITS.summary), layers };
}

function clampTo(v, d) {
  let x = v;
  if (Number.isFinite(d.min)) x = Math.max(d.min, x);
  if (Number.isFinite(d.max)) x = Math.min(d.max, x);
  return x;
}
const round = (x) => Math.round(x * 1000) / 1000;

/** Adapter interface. */
export async function generate({ text, library, groups }) {
  return sketchLook({ text, library, groups });
}
