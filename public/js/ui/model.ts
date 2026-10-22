// Shared data: the rig (SPEC "Rig"), the pattern library, group membership, layer and module helpers.
import { api, fetchJSON } from '../api.ts';
import { pixelsForGroups, prepareScene } from '../core/scene.ts';
import { BLUR_MODES, DEFAULT_SOFTEN, MAX_RADIUS } from '../core/spatial.ts';
import { isStageEnd } from '../core/warps.ts';
import type { Globals, Layer as Saved, Module, Palette, Soften, SubLayer } from '../../../shared/schemas/look.ts';
import type { LibraryEntry, ModuleEntry, PresetEntry, Rig, RigGroup } from '../../../shared/schemas/rig.ts';
import { flatModules } from '../core/tree.ts';
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
/** [{ name, theme, low, body, accent, high }] from data/palettes.json (td/palettes, by tools/build_palettes.py). */
export const loadPalettes = once(() => fetchJSON<{ palettes?: (Palette & { theme: string })[] }>(
  new URL('../../data/palettes.json', import.meta.url).href).then((d) => d.palettes || []));
export const loadLibrary = once(() => api.library().then((r) => r.patterns || []));

export const BLEND_MODES: { value: Blend; label: string; help: string }[] = [
  { value: 'add', label: 'Add', help: 'Sums light (default)' },
  { value: 'over', label: 'Over', help: 'Replaces what is below, by alpha × level' },
  { value: 'max', label: 'Max', help: 'Keeps the brighter channel' },
  { value: 'multiply', label: 'Multiply', help: 'Tints what is below' },
];
export const KIND_LABELS: Record<Kind, string> = { source: 'Source', warp: 'Warp', filter: 'Filter',
  composite: 'Composite' };
const isBlend = (b: unknown): b is Blend => BLEND_MODES.some((x) => x.value === b);

const BLANK: Record<Kind, string> = { source: `// A new layer. Describe what it does here.
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
`, composite: '' };

/** A new module. */
export function makeModule({ kind = 'source', title, code, ref, params = {} }: Partial<Module> = {}): Module {
  return { id: randomId('m'), kind, title: title || `New ${kind}`, ...(ref ? { ref } : {}), code: code || BLANK[kind],
    params: { ...params } };
}

/** A library entry as a module that remembers where it came from. */
export const moduleFromLibrary = (e: ModuleEntry) => makeModule({ kind: e.kind || 'source', title: e.title || e.name,
  ref: e.name, code: e.code });
export const isPreset = (e: { kind?: string }): e is PresetEntry => e.kind === 'preset';

/** The rig's whole: the root of its group tree. */
const rootId = (rig: Rig | null) => (rig?.groups || []).find((g) => g.parent == null)?.id ?? '';

export function makeLayer({ title = 'Layer', groups, tags, blend = 'add', level = 1, clips, modules, soften }:
  Partial<Layer>, rig: Rig | null): Layer {
  return { id: randomId('l'), title, modules: modules?.length ? cloneModules(modules) : [makeModule({ title })],
    groups: groups ? [...groups] : tags?.length ? [] : [rootId(rig)],
    ...(tags?.length ? { tags: [...tags] } : {}), blend, level,
    ...(clips?.length ? { clips: clips.map((c) => ({ ...c })) } : {}), ...(soften ? { soften: { ...soften } } : {}) };
}

/** A layer the Studio starts (blank or from the library): softened by default (SPEC "Spatial modules"). */
export const newLayer = (fields: Partial<Layer>, rig: Rig | null) => makeLayer({ soften: { ...DEFAULT_SOFTEN },
  ...fields }, rig);

/** A layer's soften as saved, or none: radius 0–MAX_RADIUS m, a known mode. */
const cleanSoften = (s: unknown): Soften | undefined => {
  const o = s && typeof s === 'object' ? s as Partial<Soften> : null, r = Number(o?.radius);
  return o && Number.isFinite(r) ? { radius: Math.min(MAX_RADIUS, Math.max(0, r)),
    mode: BLUR_MODES.includes(o.mode as Soften['mode']) ? o.mode! : 'wire' } : undefined;
};

/** Copies of modules with fresh ids, filters' inputs following them. */
function cloneModules(modules: Module[]) {
  const ids = new Map(modules.map((m) => [m.id, randomId('m')]));
  return modules.map((m) => {
    const c = { ...cleanModule(m), id: ids.get(m.id) as string };
    if (c.input) c.input = ids.get(c.input) || c.input;
    return c;
  });
}

export const layerFromPattern = (p: ModuleEntry, rig: Rig | null) => newLayer({ title: p.title || p.name || 'Layer',
  modules: [moduleFromLibrary(p)] }, rig);

/** A preset's layers, bottom first (SPEC "Library"): each module the library's by its ref, with the preset's params,
 * blend and input, fresh ids; on the whole rig, softened unless it says. Null when the library lacks a module. */
export function presetLayers(p: PresetEntry, library: LibraryEntry[], rig: Rig | null): Layer[] | null {
  const byName = new Map(library.filter((e): e is ModuleEntry => !isPreset(e)).map((e) => [e.name, e]));
  if (p.layers.some((l) => l.modules.some((m) => !byName.has(m.ref)))) return null;
  return p.layers.map((l, n) => newLayer({
    title: l.title || (p.layers.length > 1 ? `${p.title} ${n + 1}` : p.title), blend: l.blend ?? 'add',
    level: l.level ?? 1, ...(l.soften ? { soften: { ...l.soften } } : {}),
    modules: l.modules.map((m) => {
      const e = byName.get(m.ref)!, made = moduleFromLibrary(e);
      return cleanModule({ ...made, id: m.id ?? made.id, title: m.title || made.title, params: m.params ?? {},
        blend: m.blend, as: m.as, input: m.input, enabled: m.enabled === false ? false : undefined });
    }),
  }, rig));
}

/** A look's globals with what a preset needs: its macros the look lacks, and its palette when the look has none;
 * everything else stays the look's. */
export function withPresetGlobals(look: Globals | null | undefined, p: PresetEntry): Globals | undefined {
  const want = p.globals;
  if (!want) return look ?? undefined;
  const macros = { ...want.macros, ...look?.macros };
  return { ...look, ...(!look?.palette && want.palette ? { palette: want.palette } : {}),
    ...(Object.keys(macros).length ? { macros } : {}) };
}

/** Only the fields a saved module keeps (SPEC "Modules"). */
function cleanModule(m: Partial<Module>): Module {
  const kind = m.kind && KIND_LABELS[m.kind] ? m.kind : 'source';
  return {
    id: String(m.id || 'm1'), kind, title: String(m.title || KIND_LABELS[kind]),
    ...(typeof m.ref === 'string' && m.ref ? { ref: m.ref } : {}), code: String(m.code || ''),
    params: m.params && typeof m.params === 'object' ? JSON.parse(JSON.stringify(m.params)) : {},
    ...(kind === 'filter' && m.input ? { input: String(m.input) } : {}),
    ...((kind === 'warp' || kind === 'filter') && m.on ? { on: String(m.on) } : {}),
    ...(kind === 'source' && m.as === 'input' ? { as: 'input' } : {}),
    ...(isBlend(m.blend) || m.blend === 'under' ? { blend: m.blend } : {}),
    ...(m.enabled === false ? { enabled: false } : {}),
    ...(kind === 'composite' ? { layers: (m.layers ?? []).map((l) => cleanSub(l)) } : {}),
  };
}

/** Only the fields a saved sub-layer keeps (SPEC-library "Composites"). */
export const cleanSub = (l: SubLayer): SubLayer => ({ id: String(l.id), title: String(l.title || 'Sub-layer'),
  modules: l.modules.map(cleanModule), ...(l.blend ? { blend: l.blend } : {}),
  ...(typeof l.level === 'number' ? { level: l.level } : {}), ...(l.groups ? { groups: [...l.groups] } : {}),
  ...(l.tags?.length ? { tags: [...l.tags] } : {}), ...(l.enabled === false ? { enabled: false } : {}) });

/** mods with m after the selected module, so it works on it; a filter that reads its input (x) takes the nearest
 * hidden source above it. */
export function insertModule(mods: Module[], m: Module, selectedId?: string) {
  const i = mods.findIndex((x) => x.id === selectedId), at = i < 0 ? mods.length : i + 1;
  if (m.kind === 'filter' && /\bx\s*\[/.test(m.code)) {
    m.input = mods.slice(0, at).reverse().find((x) => x.kind === 'source' && x.as === 'input')?.id;
  }
  return [...mods.slice(0, at), m, ...mods.slice(at)];
}

/** A module that holds real LED colours (blur, trails): what is below it reaches up to it, no higher. The core's. */
export { isStageEnd };

export type Reach = { kind: Kind | 'input'; from: number; to: number; lane?: number };
/** How a chain is drawn (chain.tsx): each module's joint on the came (how a source combines, 'input' if it only feeds
 * a filter; else its kind), and the reaches, rows `from` to `to`: each enabled warp or filter over everything above it
 * up to a stage's end (isStageEnd), and a filter's input feed. Lane 0 is outermost; one inside a longer one, lane 1. */
export function chainWires(mods: Module[]) {
  const on = (m: Module) => m.enabled !== false, isSrc = (m: Module) => m.kind === 'source' || m.kind === 'composite';
  const size = (r: Reach) => r.to - r.from, reaches: Reach[] = [];
  const first = mods.findIndex((m) => on(m) && isSrc(m) && m.as !== 'input');
  let top = 0;
  mods.forEach((m, i) => {
    if (!on(m) || isSrc(m)) return;
    if (i > top) reaches.push({ kind: m.kind, from: top, to: i });
    const src = m.kind === 'filter' ? mods.findIndex((s) => s.id === m.input && on(s)) : -1;
    if (src >= 0 && src < i) reaches.push({ kind: 'input', from: src, to: i });
    if (isStageEnd(m)) top = i;
  });
  reaches.forEach((r, i) => { r.lane = reaches.some((o, j) => o.from <= r.to && r.from <= o.to
    && (size(o) > size(r) || (size(o) === size(r) && j < i))) ? 1 : 0; });
  return { first, reaches, joins: mods.map((m, i) => (!isSrc(m) ? m.kind : m.as === 'input' ? 'input'
    : m.blend || (i === first ? 'over' : 'add'))) };
}

type RawLayer = Partial<Layer> & { code?: string; params?: Module['params'] };
/** A layer's modules: its own, or (a look from before chains) its code and params as one source. */
const modulesOf = (l: RawLayer): Partial<Module>[] => (Array.isArray(l.modules) ? l.modules
  : [{ id: 'm1', kind: 'source', title: l.title || 'Pattern', code: l.code, params: l.params }]);

/** Only the fields a saved look keeps (SPEC "Looks"); every layer as a chain. */
export function cleanLayer(l: RawLayer): Layer {
  return {
    id: String(l.id), title: String(l.title || 'Layer'), modules: modulesOf(l).map(cleanModule),
    ...(Array.isArray(l.groups) ? { groups: [...l.groups] } : {}), ...(l.tags?.length ? { tags: [...l.tags] } : {}),
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
    for (const m of flatModules(c.modules)) { if (mods.has(m.id)) m.id = randomId('m'); mods.add(m.id); }
    c.groups ??= c.tags ? [] : [rootId(rig)];      // none given: the whole rig; [] stays: nothing
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
    /** Where a layer plays (its groups, else its tags; neither: the whole rig) as a mask, with `also`'s groups lit. */
    layerMask(groups?: readonly string[], tags?: readonly string[], ...also: (string | null)[]) {
      const mask = new Uint8Array(scene.count);
      for (const k of pixelsForGroups(scene, groups, tags)) mask[k] = 1;
      for (const id of also) if (id) masks.get(id)?.forEach((on, k) => { if (on) mask[k] = 1; });
      return mask;
    },
    ancestors(id: string) {
      const out: string[] = [];
      for (let g = byId.get(id); g?.parent; g = byId.get(g.parent)) out.push(g.parent);
      return out;
    },
  };
}
