// A layer's chain made runnable (SPEC "Modules"): each enabled module as a link (its function, params, how it
// combines, the slot of the pixel it reads), and a composite's sub-layers as chains of their own (SPEC-library
// "Composites"), each with its warps placed, its pixel slots, its colour and the LEDs it plays on.
import type { Module, SubLayer } from '../../../shared/schemas/look.ts';
import type { Compiled } from './compile.ts';
import { paramMods, resolveParams } from './globals.ts';
import type { Values } from './globals.ts';
import type { Picks } from './picks.ts';
import { makePixel, type Pixel } from './pixel.ts';
import { readsLed } from './place.ts';
import { pixelsForGroups, type Scene } from './scene.ts';
import { normalizeClips } from './timeline.ts';
import { upgradeParams } from './compile.ts';
import { isStageEnd, placeWarps } from './warps.ts';

export const MODULE_KINDS = Object.freeze(['source', 'warp', 'filter'] as const);
export type ModuleKind = (typeof MODULE_KINDS)[number];
/** What a chain may hold: the library's kinds, and a composite of sub-layers. */
export const CHAIN_KINDS = Object.freeze([...MODULE_KINDS, 'composite'] as const);
export const BLENDS = Object.freeze(['add', 'over', 'max', 'multiply'] as const);
export type Blend = (typeof BLENDS)[number];
/** How a source combines into its chain: a layer's blends, and `under` (beneath what is above it). */
export const SOURCE_BLENDS = Object.freeze([...BLENDS, 'under'] as const);
export type SourceBlend = (typeof SOURCE_BLENDS)[number];
// SPATIAL: a filter the core runs over the layer at once; COMPOSITE: sub-layers, a source to the chain round it.
export const SOURCE = 0, WARP = 1, FILTER = 2, SPATIAL = 3, COMPOSITE = 4;
export const OVER = 0, ADD = 1, MAX = 2, MULTIPLY = 3, UNDER = 4;
const BLEND = { over: OVER, add: ADD, max: MAX, multiply: MULTIPLY, under: UNDER };
const KIND: Record<string, number> = { source: SOURCE, warp: WARP, filter: FILTER, composite: COMPOSITE };
const isSourceBlend = (b: unknown): b is SourceBlend => SOURCE_BLENDS.includes(b as SourceBlend);
/** How deep composites nest: a composite may hold one, which may not. */
export const MAX_DEPTH = 2;

type Fn = (...a: unknown[]) => unknown;
/** A compiled composite: each sub-layer's modules compiled (null where disabled). */
export type CompiledComposite = { kind: 'composite', subs: (Compiled | CompiledComposite | null)[][] };
export type CompiledLink = Compiled | CompiledComposite;
const isComposite = (c: CompiledLink): c is CompiledComposite => c.kind === 'composite';

/** A sub-layer ready to run at a pixel: its chain, warps (bottom-up) and slots, its colour, where it plays. */
export type Sub = { chain: Link[], warps: Link[], qs: Pixel[], c: number[], blend: number, level: number,
  mask: Uint8Array | null };
// keep: a source's colours for a filter in a later stage (SPEC "Spatial modules"); op: a spatial one's; picks: its
// colours; ring: the frames above it (SPEC "History"); subs: a composite's.
export type Link = { id: string | null, title: string, kind: number, fn: Fn, frame: Compiled['frame'] | null,
  P: Values, mods: ReturnType<typeof paramMods>, picks: Picks | null, blend: number, hidden: boolean, input: number,
  out: number[], keep: Float64Array | null, end: boolean, ix: number, at: number, from: number, to: number,
  led: boolean, bright: boolean, ring: Compiled['history'] | null, op: Compiled['spatial'] | null,
  subs: Sub[] | null };

export const isOn = (m: { enabled?: boolean }) => m.enabled !== false;
const none = () => undefined;

/** What a chain needs from its layer: the scene (sub-layers' places and slots), its clips (clocks). */
type Ctx = { scene: Scene, clips: ReturnType<typeof normalizeClips>, all: Link[], depth: number };

/** The runnable chain of `modules`, enabled ones only; ctx.all gathers every link, sub-layers' too. */
export function prepareChain(modules: Partial<Module>[], list: readonly (CompiledLink | null)[], ctx: Ctx) {
  if (list.length !== modules.length) throw new Error('prepareLayer: compile every module (compileLayer)');
  const chain: Link[] = [], at = new Map<string | undefined, number>();
  let shown = 0;
  for (const [i, m] of modules.entries()) {
    if (!isOn(m)) continue;
    const c = list[i];
    let kind = KIND[m.kind ?? 'source'] ?? SOURCE;
    if (!c) throw new Error('prepareLayer: layer is not compiled');
    const hidden = (kind === SOURCE || kind === COMPOSITE) && m.as === 'input';
    const blend = isSourceBlend(m.blend) ? BLEND[m.blend] : shown ? ADD : OVER;
    if ((kind === SOURCE || kind === COMPOSITE) && !hidden) shown++;
    const input = kind === FILTER ? at.get(m.input) ?? -1 : -1;
    if (kind === SOURCE || kind === COMPOSITE) at.set(m.id, chain.length);
    const base = { id: m.id ?? null, title: m.title || m.id || '', blend, hidden, input, out: [0.5, 0, 0, 0],
      keep: null, ix: 0, at: 0, from: -1, to: -1, ring: null, op: null };
    let link: Link;
    if (isComposite(c)) {
      if (kind !== COMPOSITE) throw new Error('prepareLayer: layer is not compiled');
      link = { ...base, kind, fn: none, frame: null, P: {}, mods: [], picks: null, end: false, led: false,
        bright: false, subs: prepareSubs(m.layers ?? [], c, ctx, m.title || 'Composite') };
    } else {
      const fn = (kind === SOURCE ? c.pixel : kind === WARP ? c.warp : c.filter) as Fn | undefined;
      if (kind === COMPOSITE || typeof fn !== 'function') throw new Error('prepareLayer: layer is not compiled');
      if (kind === FILTER && c.spatial) kind = SPATIAL;
      const saved = upgradeParams(c, m.params) as Module['params'];
      const P = resolveParams(c.params, saved), mods = paramMods(c.params, saved, c.picks?.rot);
      c.picks?.bind(c.params, saved, P);
      c.clocks?.bind(P, mods, ctx.clips);
      link = { ...base, kind, fn, frame: c.frame || null, P, mods, picks: c.picks || null,
        end: kind === SPATIAL || isStageEnd(m), led: readsLed(m.code), bright: kind === SOURCE && !!c.bright,
        ring: c.history ?? null, op: c.spatial ?? null, subs: null };
    }
    chain.push(link);
    ctx.all.push(link);
  }
  return chain;
}

/** A composite's sub-layers, each a chain of its own; one holds no stage end (its colours are at a bent pixel, not
 * at real LEDs) and nests at most MAX_DEPTH deep. */
function prepareSubs(layers: SubLayer[], c: CompiledComposite, ctx: Ctx, title: string): Sub[] {
  if (layers.length !== c.subs.length) throw new Error('prepareLayer: compile every module (compileLayer)');
  if (ctx.depth >= MAX_DEPTH) throw new Error(`${title}: composites nest ${MAX_DEPTH} deep at most`);
  const subs: Sub[] = [], inner = { ...ctx, depth: ctx.depth + 1 };
  let shown = 0;
  for (const [i, s] of layers.entries()) {
    if (!isOn(s)) continue;
    const chain = prepareChain(s.modules, c.subs[i], inner);
    const end = chain.find((M) => M.end);
    if (end) throw new Error(`${title}: ${end.title} holds real LED colours, so it cannot go in a composite`);
    const bent = placeWarps(chain, WARP, SPATIAL), S = ctx.scene;
    const blend = isSourceBlend(s.blend) ? BLEND[s.blend] : shown++ ? ADD : OVER;
    let mask: Uint8Array | null = null;
    if (s.groups || s.tags?.length) {
      mask = new Uint8Array(S.count);
      for (const k of pixelsForGroups(S, s.groups, s.tags)) mask[k] = 1;
    }
    subs.push({ chain, warps: bent.order, qs: Array.from({ length: bent.slots }, () => makePixel(S)),
      c: [0, 0, 0, 0], blend, level: typeof s.level === 'number' ? s.level : 1, mask });
  }
  return subs;
}

/** Does any sub-layer of the chain move its pixels (so the layer needs its nearest-LED grid)? */
export const subsPlace = (all: Link[]) => all.some((M) => M.subs?.some((s) => s.warps.length));
