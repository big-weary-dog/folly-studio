// A chain as a tree in the Studio (SPEC-library "Composites"): where a module sits (the layer's chain, or a
// composite's sub-layer), and the edits that move modules in and out, group one into a composite and change a
// sub-layer. Pure: each returns a new chain, or null when the edit is not one.
import type { Module, SubLayer } from '../../../shared/schemas/look.ts';
import { flatModules, mapModule } from '../core/tree.ts';
import { randomId } from './kit.tsx';

/** A list of modules: the layer's chain (null), or sub-layer `sub` of composite `comp`. */
export type Box = { comp: string, sub: number } | null;
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

/** Module `id` moved to list `box` at `index` (counted before the move); null if that leaves a list empty, puts a
 * composite inside itself; the same chain if it changes nothing. */
export function moveModule(mods: Module[], id: string, box: Box, index: number): Module[] | null {
  const from = placeOf(mods, id);
  if (!from) return null;
  const m = listOf(mods, from.box)[from.index];
  const inside = flatModules(m.layers?.flatMap((s) => s.modules) ?? []);
  if (box && (box.comp === id || inside.some((x) => x.id === box.comp))) return null;
  const to = same(from.box, box) && from.index < index ? index - 1 : index;
  if (same(from.box, box) && to === from.index) return mods;
  if (listOf(mods, from.box).length <= 1) return null;
  const out = withList(mods, from.box, (list) => list.filter((x) => x.id !== id));
  return withList(out, box, (list) => [...list.slice(0, to), m, ...list.slice(to)]);
}

/** Module `id` in place of itself as a composite of one sub-layer holding it. */
export const groupModule = (mods: Module[], id: string): Module[] => mapModule(mods, id, (m) => ({
  id: randomId('m'), kind: 'composite', title: 'Composite', code: '', params: {},
  layers: [{ id: randomId('s'), title: m.title || 'Sub-layer', modules: [m] }],
}));

/** A new sub-layer holding `m`, on top of composite `comp`'s. */
export const addSub = (mods: Module[], comp: string, m: Module): Module[] => mapModule(mods, comp, (c) => ({ ...c,
  layers: [...c.layers ?? [], { id: randomId('s'), title: m.title || 'Sub-layer', modules: [m] }] }));

/** Sub-layer `sub` of composite `comp` changed by `patch` (null deletes it). */
export const editSub = (mods: Module[], comp: string, sub: number, patch: Partial<SubLayer> | null): Module[] =>
  mapModule(mods, comp, (c) => ({ ...c, layers: patch ? c.layers?.map((s, i) => (i === sub ? { ...s, ...patch } : s))
    : c.layers?.filter((_, i) => i !== sub) }));

/** A composite of one sub-layer in place of itself as that sub-layer's modules (null for more than one). */
export function ungroup(mods: Module[], comp: string): Module[] | null {
  const at = placeOf(mods, comp), c = at && listOf(mods, at.box)[at.index];
  if (!at || c?.layers?.length !== 1) return null;
  return withList(mods, at.box, (list) => [...list.slice(0, at.index), ...c.layers![0].modules,
    ...list.slice(at.index + 1)]);
}
