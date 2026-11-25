// Drag a module anywhere in a chain that holds composites (spec/library "Composites"): its grip, pressed and dragged
// by any pointer, marks the slot it will land in, in the layer's chain or any sub-layer's, so a module moves into a
// composite or out of one as it moves along a list. Slots are the elements marked `data-slot` ("comp sub index", or
// "- - index" for the layer's chain, then the id of the module it attaches to in an attached run, marked
// `data-attach`), in the order shown; letting go moves it, one edit. Escape puts it back. Between a composite's
// sub-layers are slots `data-sub-slot` ("comp index"): a source let go there becomes a sub-layer of its own, and a
// sub-layer's head (one of several sources) drags it among its composite's sub-layers the same way.
import type { Box } from './composite-model.ts';
import { useGripDrag } from '../grip-drag.ts';

/** What is dragged (a module's id, or a sub-layer's "comp index"), the slots it may land in, the one marked. */
type Drag = { id: string, slots: string, slot: string | null };

/** A slot's key, for `data-slot`: where a module dropped there lands, and what it attaches to there. */
export const slotKey = (box: Box, index: number, on?: string) =>
  `${box ? `${box.comp} ${box.sub}` : '- -'} ${index}${on ? ` ${on}` : ''}`;
export const parseSlot = (key: string): [Box, number, string | undefined] => {
  const [comp, sub, i, on] = key.split(' ');
  return [comp === '-' ? null : { comp, sub: Number(sub) }, Number(i), on];
};

/** A key of a `data-sub-slot` ("comp index"), not a `data-slot`. */
export const isSubSlot = (key: string) => key.split(' ').length === 2;

/** `move(id, box, index, on)` lands module id at index of list box (attached to `on`), `moveIn(id, comp, index)`
 * makes source id sub-layer index of composite comp, `moveSub(comp, k, index)` sub-layer k of composite comp at index
 * of its sub-layers. → each grip's handlers, whether a slot is marked, what is being dragged. */
export function useTreeDrag(root: { current: HTMLElement | null },
  move: (id: string, box: Box, i: number, on?: string) => void,
  moveIn: (id: string, comp: string, i: number) => void,
  moveSub: (comp: string, k: number, i: number) => void) {
  const { drag, grip: handle } = useGripDrag<Drag>(root);
  /** The first of the slots whose middle is below y (the last, the end of their list, when none is). */
  const slotAt = (d: Drag, y: number) => {
    const slots = [...root.current?.querySelectorAll<HTMLElement>(d.slots) ?? []];
    const hit = slots.find((s) => { const b = s.getBoundingClientRect(); return b.top + b.height / 2 > y; });
    const at = hit ?? slots.at(-1);
    return (at?.dataset.slot ?? at?.dataset.subSlot) ?? null;
  };
  const handlers = (id: string, slots: string, drop: (slot: string) => void) => handle({ id, slots, slot: null },
    (d, y) => { const slot = slotAt(d, y); return slot === d.slot ? d : { ...d, slot }; },
    (d) => { if (d.slot) drop(d.slot); });
  /** A module's grip; a source skips the attached runs' slots and may land between sub-layers, a warp or filter not. */
  const grip = (id: string, attaches = true) => handlers(id,
    attaches ? '[data-slot]' : '[data-slot]:not([data-attach]), [data-sub-slot]', (slot) => {
      const [comp, i] = slot.split(' ');
      if (isSubSlot(slot)) moveIn(id, comp, Number(i));
      else move(id, ...parseSlot(slot));
    });
  const subGrip = (comp: string, k: number) => handlers(`${comp} ${k}`, `[data-sub-slot^="${comp} "]`,
    (slot) => moveSub(comp, k, Number(slot.split(' ')[1])));
  return { grip, subGrip, marked: (box: Box, i: number, on?: string) => drag?.slot === slotKey(box, i, on),
    subMarked: (comp: string, i: number) => drag?.slot === `${comp} ${i}`,
    dragging: drag?.id ?? null };
}
export type TreeDrag = ReturnType<typeof useTreeDrag>;
