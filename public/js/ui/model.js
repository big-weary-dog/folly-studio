// Shared data: the rig (SPEC "Rig"), the pattern library, group membership, layer and module helpers.
import { api, fetchJSON } from '../api.js';
import { pixelsForGroups, prepareScene } from '../core/scene.js';
import { randomId } from './dom.js';

/** load() once: its promise is shared, and forgotten if it fails so the next call tries again. */
const once = (load) => {
  let p = null;
  return () => (p ||= load().catch((err) => { p = null; throw err; }));
};
export const loadRig = once(() => fetchJSON('/data/rig.json'));
/** [{ name, low, body, accent, high }] from data/palettes.json (td/palettes, by tools/build_palettes.py). */
export const loadPalettes = once(() => fetchJSON('/data/palettes.json').then((d) => d.palettes || []));
/** [{ name, title, summary, kind, category, code }] from /api/library. */
export const loadLibrary = once(() => api.library().then((r) => r.patterns || []));

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
  { title = 'Layer', code = BLANK_CODE, groups, tags, blend = 'add', level = 1, params = {}, clips, modules } = {},
  rig,
) {
  const chain = modules && modules.length ? cloneModules(modules) : [makeModule({ title, code, params })];
  return { id: randomId('l'), title, modules: chain,
    groups: groups?.length ? [...groups] : tags?.length ? [] : [rootId(rig)],
    ...(tags?.length ? { tags: [...tags] } : {}), blend, level,
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

export function layerFromPattern(pattern, rig) {
  return makeLayer({ title: pattern.title || pattern.name || 'Layer', modules: [moduleFromLibrary(pattern)] },
    rig);
}

/** The rig's whole: the root of its group tree. */
const rootId = (rig) => (rig?.groups || []).find((g) => g.parent == null)?.id;

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
    ...(Array.isArray(l.tags) && l.tags.length ? { tags: [...l.tags] } : {}),
    blend: isBlend(l.blend) ? l.blend : 'add',
    level: Number.isFinite(+l.level) ? Math.min(1, Math.max(0, +l.level)) : 1,
    // Timeline clips pass through untouched (the server validates them).
    ...(Array.isArray(l.clips) ? { clips: l.clips.map((c) => ({ ...c })) } : {}),
  };
}

/** Normalise layers from the server or a file: layer and module ids unique, fields present. */
export function normaliseLayers(layers, rig) {
  const seen = new Set();
  return (Array.isArray(layers) ? layers : []).map((l) => {
    const c = cleanLayer(l || {});
    if (!c.id || seen.has(c.id)) c.id = randomId('l');
    seen.add(c.id);
    const mods = new Set();
    for (const m of c.modules) { if (mods.has(m.id)) m.id = randomId('m'); mods.add(m.id); }
    if (!c.groups.length && !c.tags) c.groups = [rootId(rig)];
    return c;
  });
}

/** Each group's LEDs (the core's membership rule) as masks: Map id → Uint8Array(count); its tree; its ancestors. */
export function buildGroupIndex(rig) {
  const scene = prepareScene(rig), byId = scene.groupById;
  const masks = new Map(), counts = new Map(), children = new Map();
  for (const g of scene.groups) {
    const idx = pixelsForGroups(scene, [g.id]), mask = new Uint8Array(scene.count);
    for (const k of idx) mask[k] = 1;
    masks.set(g.id, mask);
    counts.set(g.id, idx.length);
    const p = g.parent ?? null;
    children.set(p, [...(children.get(p) || []), g]);
  }
  return {
    masks, counts, children, byId, root: scene.root?.id,
    ancestors(id) {
      const out = [];
      for (let g = byId.get(id); g?.parent; g = byId.get(g.parent)) out.push(g.parent);
      return out;
    },
  };
}
