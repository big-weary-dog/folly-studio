// A chain as a tree in the Studio (SPEC-library "Composites"): where a module sits (the layer's chain, or a
// composite's sub-layer), and the edits that move modules in and out, attach a warp or filter to one module, group
// one into a composite and change a sub-layer. A sub-layer a module's move or delete leaves empty goes with it (the
// last of a composite's stays). Pure: each returns a new chain, or null when the edit is not one.
import type { Module, SubLayer } from '../../../shared/schemas/look.ts';
import { attachedTo, flatModules, mapModule, runEnd } from '../core/tree.ts';
import { randomId } from './kit.tsx';
import { insertModule } from './model.ts';

/** A list of modules: the layer's chain (null), or sub-layer `sub` of composite `comp`. */
export type Box = { comp: string, sub: number } | null;
/** The sub-layers a composite holds at most (the schema's MAX_SUBLAYERS). */
export const MAX_SUBLAYERS = 4;
const same = (a: Box, b: Box) => a === b || (!!a && !!b && a.comp === b.comp && a.sub === b.sub);

/** Where module `id` sits: its list and index there, or null. */
export function placeOf(mods: Module[], id: string, box: Box = null): { box: Box, index: number } | null {
  for (const [i, m] of mods.entries()) {
    if (m.id === id) return { box, index: i };
    for (const [s, l] of (m.layers ?? []).entries()) {
      const at = placeOf(l.modules, id, { comp: m.id, sub: s });
      if (at) return at;
    }
  }
  return null;
}

/** The modules of a list. */
export function listOf(mods: Module[], box: Box): Module[] {
  if (!box) return mods;
  return flatModules(mods).find((m) => m.id === box.comp)?.layers?.[box.sub]?.modules ?? [];
}

/** The chain with list `box` as fn(it). */
export function withList(mods: Module[], box: Box, fn: (list: Module[]) => Module[]): Module[] {
  if (!box) return fn(mods);
  return mapModule(mods, box.comp, (c) => ({ ...c, layers: c.layers?.map((s, i) => (i === box.sub
    ? { ...s, modules: fn(s.modules.slice()) } : s)) }));
}

/** The composite `comp` names. */
const compOf = (mods: Module[], comp: string) => flatModules(mods).find((m) => m.id === comp);
/** Can list `box` go, as the move or delete of all it holds would leave it empty? (It is a sub-layer, not the last.) */
const goes = (mods: Module[], box: Box): box is NonNullable<Box> => !!box
  && (compOf(mods, box.comp)?.layers?.length ?? 0) > 1;
/** `block`, the whole of list `box`, gone from it: that sub-layer gone, or, when it cannot go, null. */
function without(mods: Module[], box: Box, block: Module[]): Module[] | null {
  const list = listOf(mods, box);
  if (list.length > block.length) return withList(mods, box, (x) => x.filter((y) => !block.includes(y)));
  return goes(mods, box) ? editSub(mods, box.comp, box.sub, null) : null;
}
/** `box` after sub-layer `gone` of its composite has gone (null: none has). */
const after = (box: Box, gone: Box): Box => (box && gone && box.comp === gone.comp && box.sub > gone.sub
  ? { ...box, sub: box.sub - 1 } : box);
/** Does `block` hold composite `comp` (moving it there would put it inside itself)? */
const holds = (block: Module[], comp: string) => flatModules(block).some((x) => x.id === comp);
const isSource = (m: Module) => m.kind === 'source' || m.kind === 'composite';

/** Module `id` moved to list `box` at `index` (counted before the move), attached to module `on` there or not
 * (SPEC-library "Attached modules"), a source with its attached run; the sub-layer it leaves empty goes, its blend
 * the module's; null if that leaves a composite empty, puts a composite inside itself, attaches what is not a warp or
 * filter or splits a run; the same chain if it changes nothing. */
export function moveModule(mods: Module[], id: string, box: Box, index: number, on?: string): Module[] | null {
  const from = placeOf(mods, id);
  if (!from) return null;
  const list = listOf(mods, from.box), m = list[from.index];
  if (on && m.kind !== 'warp' && m.kind !== 'filter') return null;
  const block = list.slice(from.index, m.on ? from.index + 1 : runEnd(list, from.index));
  if (box && holds(block, box.comp)) return null;
  const here = same(from.box, box);
  if (here && index > from.index && index < from.index + block.length) return null;
  const to = here && from.index < index ? index - block.length : index;
  if (here && to === from.index && m.on === on) return mods;
  const gone = !here && list.length <= block.length ? from.box : null;
  const out = here ? withList(mods, box, (x) => x.filter((y) => !block.includes(y))) : without(mods, from.box, block);
  if (!out) return null;
  const { on: _, ...rest } = m, blend = gone && !m.blend ? listSub(mods, gone)?.blend : undefined;
  const moved: Module = { ...rest, ...(on ? { on } : {}), ...(blend ? { blend } : {}) }, into = after(box, gone);
  const next = withList(out, into, (x) => [...x.slice(0, to), moved, ...block.slice(1), ...x.slice(to)]);
  return runsHold(listOf(next, into)) && (gone || runsHold(listOf(next, from.box))) ? next : null;
}
/** Sub-layer `box`. */
const listSub = (mods: Module[], box: NonNullable<Box>): SubLayer | undefined =>
  compOf(mods, box.comp)?.layers?.[box.sub];

/** Source `id` with its attached run made sub-layer `index` of composite `comp` (counted before the move), its blend
 * the sub-layer's; a whole sub-layer moves as itself, so it keeps its name, blend and where it plays. Null if that
 * leaves a composite empty, puts one inside itself or makes one more than it holds. */
export function moveToSub(mods: Module[], id: string, comp: string, index: number): Module[] | null {
  const from = placeOf(mods, id), list = from ? listOf(mods, from.box) : [], m = from && list[from.index];
  if (!from || !m || m.on || !isSource(m)) return null;
  const block = list.slice(from.index, runEnd(list, from.index)), whole = block.length === list.length;
  if (whole && from.box?.comp === comp) return moveSub(mods, comp, from.box.sub, index);
  if (holds(block, comp) || (compOf(mods, comp)?.layers?.length ?? MAX_SUBLAYERS) >= MAX_SUBLAYERS) return null;
  const { blend, ...lead } = m;
  const sub: SubLayer = whole && from.box ? listSub(mods, from.box)!
    : { id: randomId('s'), title: m.title || 'Sub-layer', modules: [lead, ...block.slice(1)],
      ...(blend ? { blend } : {}) };
  const out = without(mods, from.box, block), gone = whole ? from.box : null;
  const at = gone && gone.comp === comp && gone.sub < index ? index - 1 : index;
  return out && mapModule(out, comp, (c) => ({ ...c,
    layers: [...c.layers!.slice(0, at), sub, ...c.layers!.slice(at)] }));
}
/** Is every attached module of `list` in its source's run? */
const runsHold = (list: Module[]) => list.every((x, j) => !x.on || attachedTo(list, j) === x.on);

/** `m` added after module `id` of `list` (model.ts insertModule): past its attached run, or, a warp or filter after an
 * attached module, in that run. */
export function addAfter(list: Module[], m: Module, id?: string): Module[] {
  const i = list.findIndex((x) => x.id === id), on = list[i]?.on;
  if (i < 0) return insertModule(list, m, id);
  if (on && (m.kind === 'warp' || m.kind === 'filter')) return insertModule(list, { ...m, on }, id);
  return insertModule(list, m, list[runEnd(list, on ? list.findIndex((x) => x.id === on) : i) - 1].id);
}

/** The deletion's run: an attached processor alone, or a module with its attachments. */
export const removalBlock = (list: Module[], i: number) => list.slice(i, list[i].on ? i + 1 : runEnd(list, i));
/** Module `id`, a source with its attached run, gone from its list (and the sub-layer that leaves empty). */
export function removeModule(mods: Module[], id: string): Module[] | null {
  const at = placeOf(mods, id), list = at && listOf(mods, at.box);
  if (!at || !list) return null;
  return without(mods, at.box, removalBlock(list, at.index));
}
/** Can module `id` go (its delete leaves no composite empty and no layer without modules)? */
export const removable = (mods: Module[], id: string) => removeModule(mods, id) !== null;

/** Module `id` in place of itself as a composite of one sub-layer holding it, with its attached run. */
export function groupModule(mods: Module[], id: string): Module[] {
  const at = placeOf(mods, id), list = at ? listOf(mods, at.box) : [];
  if (!at || list[at.index].on) return mods;
  const block = list.slice(at.index, runEnd(list, at.index)), m = block[0];
  return withList(mods, at.box, (x) => [...x.slice(0, at.index), { id: randomId('m'), kind: 'composite',
    title: 'Composite', code: '', params: {}, layers: [{ id: randomId('s'), title: m.title || 'Sub-layer',
      modules: block }] }, ...x.slice(at.index + block.length)]);
}

/** A new sub-layer holding `m`, on top of composite `comp`'s. */
export const addSub = (mods: Module[], comp: string, m: Module): Module[] => mapModule(mods, comp, (c) => ({ ...c,
  layers: [...c.layers ?? [], { id: randomId('s'), title: m.title || 'Sub-layer', modules: [m] }] }));

/** Sub-layer `sub` of composite `comp` changed by `patch` (null deletes it). */
export const editSub = (mods: Module[], comp: string, sub: number, patch: Partial<SubLayer> | null): Module[] =>
  mapModule(mods, comp, (c) => ({ ...c, layers: patch ? c.layers?.map((s, i) => (i === sub ? { ...s, ...patch } : s))
    : c.layers?.filter((_, i) => i !== sub) }));

/** Sub-layer `sub` of composite `comp` moved to `index` of its sub-layers (counted before the move). */
export const moveSub = (mods: Module[], comp: string, sub: number, index: number): Module[] => {
  const to = index > sub ? index - 1 : index;
  return to === sub ? mods : mapModule(mods, comp, (c) => {
    const layers = (c.layers ?? []).slice(), [s] = layers.splice(sub, 1);
    return { ...c, layers: [...layers.slice(0, to), s, ...layers.slice(to)] };
  });
};

/** A composite of one sub-layer in place of itself as that sub-layer's modules (null for more than one). */
export function ungroup(mods: Module[], comp: string): Module[] | null {
  const at = placeOf(mods, comp), c = at && listOf(mods, at.box)[at.index];
  if (!at || c?.layers?.length !== 1) return null;
  return withList(mods, at.box, (list) => [...list.slice(0, at.index), ...c.layers![0].modules,
    ...list.slice(at.index + 1)]);
}
