// Shared data: the cathedral model, the pattern library, group membership, layer and module helpers.
import { api, fetchJSON } from '../api.js';
import { randomId } from './dom.js';

let cathedralP = null;
export function loadCathedral() {
  cathedralP ||= fetchJSON('/data/cathedral.json').catch((err) => { cathedralP = null; throw err; });
  return cathedralP;
}

let palettesP = null;
/** [{ name, low, body, accent, high }] from data/palettes.json (td/palettes, by tools/build_palettes.py). */
export function loadPalettes() {
  palettesP ||= fetchJSON('/data/palettes.json').then((d) => (Array.isArray(d.palettes) ? d.palettes : []))
    .catch((err) => { palettesP = null; throw err; });
  return palettesP;
}

let libraryP = null;
/** [{ name, title, summary, kind, category, code }] from /api/library. */
export function loadLibrary() {
  libraryP ||= api.library().then((r) => (Array.isArray(r.patterns) ? r.patterns : []))
    .catch((err) => { libraryP = null; throw err; });
  return libraryP;
}

export const BLEND_MODES = [
  { value: 'add', label: 'Add', help: 'Sums light (default)' },
  { value: 'over', label: 'Over', help: 'Replaces what is below, by alpha × level' },
  { value: 'max', label: 'Max', help: 'Keeps the brighter channel' },
  { value: 'multiply', label: 'Multiply', help: 'Tints what is below' },
];

export const BLANK_CODE = `// A new layer. Describe what it does here.
const params = {
  color: { value: '#5b8cff', type: 'color' },
  speed: { value: 0.5, min: 0, max: 2 },
  width: { value: 0.25, min: 0.02, max: 1 },
};

function pixel(p, t, P) {
  // a soft band of light climbing what this layer lands on
  const v = pulse(fract(p.ly - t * P.speed), P.width);
  return scale(P.color, v);
}
`;

const BLANK_WARP = `// A new warp: it moves each pixel for the modules after it.
const params = {
  speed: { value: 0.1, min: -1, max: 1 },
};

function warp(q, t, P, G) {
  // slide what comes after across the layer
  q.lz = fract(q.lz + t * P.speed);
}
`;

const BLANK_FILTER = `// A new filter: it reworks the chain's colour so far.
const params = {
  amount: { value: 0.5, min: 0, max: 1 },
};

function filter(c, q, t, P, G, x) {
  // c is [r, g, b, a]: change it and hand it back (x: the input's colour)
  const v = max(c[0], c[1], c[2]);
  for (let i = 0; i < 3; i++) c[i] = mix(c[i], v, P.amount);
  return c;
}
`;
export const BLANK = { source: BLANK_CODE, warp: BLANK_WARP, filter: BLANK_FILTER };
export const KIND_LABELS = { source: 'Source', warp: 'Warp', filter: 'Filter' };

/** A new module: { id, kind, title, ref?, code, params }. */
export function makeModule({ kind = 'source', title, code, ref, params = {} } = {}) {
  return { id: randomId('m'), kind, title: title || `New ${kind}`, ...(ref ? { ref } : {}), code: code || BLANK[kind],
    params: { ...params } };
}

/** A library entry as a module that remembers where it came from. */
export function moduleFromLibrary(entry) {
  return makeModule({ kind: entry.kind || 'source', title: entry.title || entry.name, ref: entry.name,
    code: entry.code });
}

export function makeLayer(
  { title = 'Layer', code = BLANK_CODE, groups, blend = 'add', level = 1, params = {}, clips, modules } = {},
  cathedral,
) {
  const chain = modules && modules.length ? cloneModules(modules) : [makeModule({ title, code, params })];
  return { id: randomId('l'), title, modules: chain,
    groups: groups && groups.length ? [...groups] : [defaultGroupId(cathedral)], blend, level,
    ...(clips && clips.length ? { clips: clips.map((c) => ({ ...c })) } : {}) };
}

/** Copies of modules with fresh ids, filters' inputs following them. */
export function cloneModules(modules) {
  const ids = new Map(modules.map((m) => [m.id, randomId('m')]));
  return modules.map((m) => {
    const c = { ...cleanModule(m), id: ids.get(m.id) };
    if (c.input) c.input = ids.get(c.input) || c.input;
    return c;
  });
}

export function layerFromPattern(pattern, cathedral) {
  return makeLayer({ title: pattern.title || pattern.name || 'Layer', modules: [moduleFromLibrary(pattern)] },
    cathedral);
}

export function defaultGroupId(cathedral) {
  const groups = cathedral?.groups || [];
  if (groups.some((g) => g.id === 'cathedral')) return 'cathedral';
  const root = groups.find((g) => !g.parent);
  return root ? root.id : 'cathedral';
}

const isBlend = (b) => BLEND_MODES.some((x) => x.value === b);
const copyParams = (p) => (p && typeof p === 'object' ? JSON.parse(JSON.stringify(p)) : {});

/** Only the fields a saved module keeps (SPEC "Modules"). */
export function cleanModule(m) {
  const kind = KIND_LABELS[m.kind] ? m.kind : 'source';
  return {
    id: String(m.id || 'm1'), kind, title: String(m.title || KIND_LABELS[kind]),
    ...(typeof m.ref === 'string' && m.ref ? { ref: m.ref } : {}), code: String(m.code || ''),
    params: copyParams(m.params),
    ...(kind === 'filter' && m.input ? { input: String(m.input) } : {}),
    ...(kind === 'source' && m.as === 'input' ? { as: 'input' } : {}),
    ...(isBlend(m.blend) ? { blend: m.blend } : {}), ...(m.enabled === false ? { enabled: false } : {}),
  };
}

/** A layer's modules: its own, or (a look from before chains) its code and params as one source. */
export const modulesOf = (l) => (Array.isArray(l.modules) ? l.modules
  : [{ id: 'm1', kind: 'source', title: l.title || 'Pattern', code: l.code, params: l.params }]);

/** Only the fields a saved look keeps (SPEC "Looks"); every layer as a chain. */
export function cleanLayer(l) {
  return {
    id: String(l.id),
    title: String(l.title || 'Layer'),
    modules: modulesOf(l).map(cleanModule),
    groups: Array.isArray(l.groups) ? [...l.groups] : [],
    blend: isBlend(l.blend) ? l.blend : 'add',
    level: Number.isFinite(+l.level) ? Math.min(1, Math.max(0, +l.level)) : 1,
    // Timeline clips pass through untouched (the server validates them).
    ...(Array.isArray(l.clips) ? { clips: l.clips.map((c) => ({ ...c })) } : {}),
  };
}

/** Normalise layers from the server or a file: layer and module ids unique, fields present. */
export function normaliseLayers(layers, cathedral) {
  const seen = new Set();
  return (Array.isArray(layers) ? layers : []).map((l) => {
    const c = cleanLayer(l || {});
    if (!c.id || seen.has(c.id)) c.id = randomId('l');
    seen.add(c.id);
    const mods = new Set();
    for (const m of c.modules) { if (mods.has(m.id)) m.id = randomId('m'); mods.add(m.id); }
    if (!c.groups.length) c.groups = [defaultGroupId(cathedral)];
    return c;
  });
}

/** Precomputed group masks: Map id → Uint8Array(count). */
export function buildGroupIndex(cathedral) {
  const { count, zones: zoneNames = [], pixels } = cathedral;
  const zoneOf = (z) => (typeof z === 'number' ? z : zoneNames.indexOf(z));
  const masks = new Map(), counts = new Map();
  for (const g of cathedral.groups || []) {
    const zones = new Set((g.zones || []).map(zoneOf));
    const strands = new Set(g.strands || []);
    const rows = Array.isArray(g.rows) && g.rows.length ? new Set(g.rows) : null;
    const m = new Uint8Array(count);
    let n = 0;
    for (let i = 0; i < count; i++) {
      let hit = zones.has(pixels.zone[i]) || strands.has(pixels.strand[i]);
      if (hit && rows) hit = rows.has(pixels.row[i]);
      if (hit) { m[i] = 1; n++; }
    }
    masks.set(g.id, m);
    counts.set(g.id, n);
  }
  const children = new Map();
  for (const g of cathedral.groups || []) {
    const p = g.parent ?? null;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(g);
  }
  const byId = new Map((cathedral.groups || []).map((g) => [g.id, g]));
  return {
    masks, counts, children, byId,
    /** Union mask of several group ids (null if none). */
    union(ids) {
      const list = (ids || []).map((id) => masks.get(id)).filter(Boolean);
      if (!list.length) return null;
      if (list.length === 1) return list[0];
      const out = new Uint8Array(count);
      for (const m of list) for (let i = 0; i < count; i++) out[i] |= m[i];
      return out;
    },
    countOf(ids) {
      const u = this.union(ids);
      if (!u) return 0;
      let n = 0;
      for (let i = 0; i < count; i++) n += u[i];
      return n;
    },
    ancestors(id) {
      const out = [];
      let g = byId.get(id);
      while (g && g.parent) { out.push(g.parent); g = byId.get(g.parent); }
      return out;
    },
  };
}
