// Shared data: the rig (SPEC "Rig"), the pattern library, group membership, layer and module helpers.
import { api, fetchJSON } from '../api.ts';
import { pixelsForGroups, prepareScene } from '../core/scene.ts';
import { BLUR_MODES, DEFAULT_SOFTEN, MAX_RADIUS } from '../core/spatial.ts';
import type { Layer as Saved, Module, Palette, Soften } from '../../../shared/schemas/look.ts';
import type { LibraryEntry, Rig, RigGroup } from '../../../shared/schemas/rig.ts';
import { randomId } from './kit.tsx';

/** A layer as the Studio holds it (SPEC "Modules"): a chain, never code and params; `enabled: false` when silent. */
export type Layer = Extract<Saved, { modules: unknown }>;
type Kind = Module['kind'];
type Blend = Layer['blend'];

/** load() once: its promise is shared, and forgotten if it fails so the next call tries again. */
const once = <T>(load: () => Promise<T>) => {
  let p: Promise<T> | null = null;
  return () => (p ||= load().catch((err) => { p = null; throw err; }));
};
export const loadRig = once(() => fetchJSON<Rig>(new URL('../../data/rig.json', import.meta.url).href));
/** [{ name, low, body, accent, high }] from data/palettes.json (td/palettes, by tools/build_palettes.py). */
export const loadPalettes = once(() => fetchJSON<{ palettes?: Palette[] }>(
  new URL('../../data/palettes.json', import.meta.url).href).then((d) => d.palettes || []));
export const loadLibrary = once(() => api.library().then((r) => r.patterns || []));

export const BLEND_MODES: { value: Blend; label: string; help: string }[] = [
  { value: 'add', label: 'Add', help: 'Sums light (default)' },
  { value: 'over', label: 'Over', help: 'Replaces what is below, by alpha × level' },
  { value: 'max', label: 'Max', help: 'Keeps the brighter channel' },
  { value: 'multiply', label: 'Multiply', help: 'Tints what is below' },
];
export const KIND_LABELS: Record<Kind, string> = { source: 'Source', warp: 'Warp', filter: 'Filter' };
const isBlend = (b: unknown): b is Blend => BLEND_MODES.some((x) => x.value === b);

export const BLANK: Record<Kind, string> = { source: `// A new layer. Describe what it does here.
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
`, warp: `// A new warp: it moves each pixel for everything above it.
const params = {
  speed: { value: 0.1, min: -1, max: 1 },
};

function warp(q, t, P, G) {
  // slide what is above across the layer
  q.lz = fract(q.lz + t * P.speed);
}
`, filter: `// A new filter: it reworks the chain's colour so far.
const params = {
  amount: { value: 0.5, min: 0, max: 1 },
};

function filter(c, q, t, P, G, x) {
  // c is [r, g, b, a]: change it and hand it back (x: the input's colour)
  const v = max(c[0], c[1], c[2]);
  for (let i = 0; i < 3; i++) c[i] = mix(c[i], v, P.amount);
  return c;
}
` };

/** A new module. */
export function makeModule({ kind = 'source', title, code, ref, params = {} }: Partial<Module> = {}): Module {
  return { id: randomId('m'), kind, title: title || `New ${kind}`, ...(ref ? { ref } : {}), code: code || BLANK[kind],
    params: { ...params } };
}

/** A library entry as a module that remembers where it came from. */
export const moduleFromLibrary = (e: LibraryEntry) => makeModule({ kind: e.kind || 'source', title: e.title || e.name,
  ref: e.name, code: e.code });

/** The rig's whole: the root of its group tree. */
const rootId = (rig: Rig | null) => (rig?.groups || []).find((g) => g.parent == null)?.id ?? '';

export function makeLayer({ title = 'Layer', groups, tags, blend = 'add', level = 1, clips, modules, soften }:
  Partial<Layer>, rig: Rig | null): Layer {
  return { id: randomId('l'), title, modules: modules?.length ? cloneModules(modules) : [makeModule({ title })],
    groups: groups?.length ? [...groups] : tags?.length ? [] : [rootId(rig)],
    ...(tags?.length ? { tags: [...tags] } : {}), blend, level,
    ...(clips?.length ? { clips: clips.map((c) => ({ ...c })) } : {}), ...(soften ? { soften: { ...soften } } : {}) };
}

/** A layer the Studio starts (blank or from the library): softened by default (SPEC "Spatial modules"). */
export const newLayer = (fields: Partial<Layer>, rig: Rig | null) => makeLayer({ soften: { ...DEFAULT_SOFTEN },
  ...fields }, rig);

/** A layer's soften as saved, or none: radius 0–MAX_RADIUS m, a known mode. */
export const cleanSoften = (s: unknown): Soften | undefined => {
  const o = s && typeof s === 'object' ? s as Partial<Soften> : null, r = Number(o?.radius);
  return o && Number.isFinite(r) ? { radius: Math.min(MAX_RADIUS, Math.max(0, r)),
    mode: BLUR_MODES.includes(o.mode as Soften['mode']) ? o.mode! : 'wire' } : undefined;
};

/** Copies of modules with fresh ids, filters' inputs following them. */
export function cloneModules(modules: Module[]) {
  const ids = new Map(modules.map((m) => [m.id, randomId('m')]));
  return modules.map((m) => {
    const c = { ...cleanModule(m), id: ids.get(m.id) as string };
    if (c.input) c.input = ids.get(c.input) || c.input;
    return c;
  });
}

export const layerFromPattern = (p: LibraryEntry, rig: Rig | null) => newLayer({ title: p.title || p.name || 'Layer',
  modules: [moduleFromLibrary(p)] }, rig);

/** Only the fields a saved module keeps (SPEC "Modules"). */
export function cleanModule(m: Partial<Module>): Module {
  const kind = m.kind && KIND_LABELS[m.kind] ? m.kind : 'source';
  return {
    id: String(m.id || 'm1'), kind, title: String(m.title || KIND_LABELS[kind]),
    ...(typeof m.ref === 'string' && m.ref ? { ref: m.ref } : {}), code: String(m.code || ''),
    params: m.params && typeof m.params === 'object' ? JSON.parse(JSON.stringify(m.params)) : {},
    ...(kind === 'filter' && m.input ? { input: String(m.input) } : {}),
    ...(kind === 'source' && m.as === 'input' ? { as: 'input' } : {}),
    ...(isBlend(m.blend) || m.blend === 'under' ? { blend: m.blend } : {}),
    ...(m.enabled === false ? { enabled: false } : {}),
  };
}

type RawLayer = Partial<Layer> & { code?: string; params?: Module['params'] };
/** A layer's modules: its own, or (a look from before chains) its code and params as one source. */
const modulesOf = (l: RawLayer): Partial<Module>[] => (Array.isArray(l.modules) ? l.modules
  : [{ id: 'm1', kind: 'source', title: l.title || 'Pattern', code: l.code, params: l.params }]);

/** Only the fields a saved look keeps (SPEC "Looks"); every layer as a chain. */
export function cleanLayer(l: RawLayer): Layer {
  return {
    id: String(l.id), title: String(l.title || 'Layer'), modules: modulesOf(l).map(cleanModule),
    groups: Array.isArray(l.groups) ? [...l.groups] : [], ...(l.tags?.length ? { tags: [...l.tags] } : {}),
    blend: isBlend(l.blend) ? l.blend : 'add',
    level: Number.isFinite(Number(l.level)) ? Math.min(1, Math.max(0, Number(l.level))) : 1,
    // Timeline clips pass through untouched (the server validates them).
    ...(Array.isArray(l.clips) ? { clips: l.clips.map((c) => ({ ...c })) } : {}),
    ...(cleanSoften(l.soften) ? { soften: cleanSoften(l.soften) } : {}),
  };
}

/** Normalise layers from the server or a file: layer and module ids unique, fields present. */
export function normaliseLayers(layers: unknown, rig: Rig | null) {
  const seen = new Set<string>();
  return (Array.isArray(layers) ? layers : []).map((l: RawLayer) => {
    const c = cleanLayer(l || {});
    if (!c.id || seen.has(c.id)) c.id = randomId('l');
    seen.add(c.id);
    const mods = new Set<string>();
    for (const m of c.modules) { if (mods.has(m.id)) m.id = randomId('m'); mods.add(m.id); }
    if (!c.groups.length && !c.tags) c.groups = [rootId(rig)];
    return c;
  });
}

export type GroupIndex = ReturnType<typeof buildGroupIndex>;
/** Each group's LEDs (the core's membership rule) as masks, its tree and its ancestors. */
export function buildGroupIndex(rig: Rig) {
  const scene = prepareScene(rig), byId = scene.groupById;
  const masks = new Map<string, Uint8Array>(), counts = new Map<string, number>();
  const children = new Map<string | null, RigGroup[]>();
  for (const g of scene.groups) {
    const idx = pixelsForGroups(scene, [g.id]), mask = new Uint8Array(scene.count);
    for (const k of idx) mask[k] = 1;
    masks.set(g.id, mask);
    counts.set(g.id, idx.length);
    const p = g.parent ?? null;
    children.set(p, [...(children.get(p) || []), g]);
  }
  return {
    masks, counts, children, byId, root: scene.root?.id ?? '',
    ancestors(id: string) {
      const out: string[] = [];
      for (let g = byId.get(id); g?.parent; g = byId.get(g.parent)) out.push(g.parent);
      return out;
    },
  };
}
