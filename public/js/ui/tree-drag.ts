// Drag a module anywhere in a chain that holds composites (SPEC-library "Composites"): its grip, pressed and dragged
// by any pointer, marks the slot it will land in, in the layer's chain or any sub-layer's, so a module moves into a
// composite or out of one as it moves along a list. Slots are the elements marked `data-slot` ("comp sub index", or
// "- - index" for the layer's chain), in the order shown; letting go moves it, one edit. Escape puts it back. A
// sub-layer's head drags it the same way among its composite's sub-layers (slots `data-sub-slot`, "comp index").
import { useEffect, useRef, useState } from 'preact/hooks';

import type { Box } from './composite-model.ts';

/** What is dragged (a module's id, or a sub-layer's "comp index"), the slots it may land in, the one marked. */
type Drag = { id: string, slots: string, slot: string | null } | null;
const EDGE = 28, STEP = 12;

/** A slot's key, for `data-slot`: where a module dropped there lands. */
export const slotKey = (box: Box, index: number) => `${box ? `${box.comp} ${box.sub}` : '- -'} ${index}`;
export const parseSlot = (key: string): [Box, number] => {
  const [comp, sub, i] = key.split(' ');
  return [comp === '-' ? null : { comp, sub: Number(sub) }, Number(i)];
};

/** `move(id, box, index)` lands module id at index of list box, `moveSub(comp, k, index)` sub-layer k of composite
 * comp at index of its sub-layers. → each grip's handlers, whether a slot is marked, what is being dragged. */
export function useTreeDrag(root: { current: HTMLElement | null }, move: (id: string, box: Box, i: number) => void,
  moveSub: (comp: string, k: number, i: number) => void) {
  const [drag, show] = useState<Drag>(null);
  const live = useRef<Drag>(null);
  const set = (d: Drag) => { live.current = d; show(d); };
  const on = drag !== null;
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      set(null);
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [on]);
  /** The first of the slots whose middle is below y (the last, the end of their list, when none is). */
  const slotAt = (d: NonNullable<Drag>, y: number) => {
    const slots = [...root.current?.querySelectorAll<HTMLElement>(d.slots) ?? []];
    const hit = slots.find((s) => { const b = s.getBoundingClientRect(); return b.top + b.height / 2 > y; });
    const at = hit ?? slots.at(-1);
    return (at?.dataset.slot ?? at?.dataset.subSlot) ?? null;
  };
  const scroll = (y: number) => {
    const pane = root.current?.closest('.pane-body'), b = pane?.getBoundingClientRect();
    if (pane && b) pane.scrollTop += y < b.top + EDGE ? -STEP : y > b.bottom - EDGE ? STEP : 0;
  };
  const handlers = (id: string, slots: string, drop: (slot: string) => void) => ({
    onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      set({ id, slots, slot: null });
    },
    onPointerMove(e: PointerEvent) {
      const d = live.current;
      if (!d) return;
      scroll(e.clientY);
      const slot = slotAt(d, e.clientY);
      if (slot !== d.slot) set({ ...d, slot });
    },
    onPointerUp() {
      const d = live.current;
      set(null);
      if (d?.slot) drop(d.slot);
    },
    onPointerCancel: () => set(null),
  });
  const grip = (id: string) => handlers(id, '[data-slot]', (slot) => move(id, ...parseSlot(slot)));
  const subGrip = (comp: string, k: number) => handlers(`${comp} ${k}`, `[data-sub-slot^="${comp} "]`,
    (slot) => moveSub(comp, k, Number(slot.split(' ')[1])));
  return { grip, subGrip, marked: (box: Box, i: number) => drag?.slot === slotKey(box, i),
    subMarked: (comp: string, i: number) => drag?.slot === `${comp} ${i}`,
    dragging: drag?.id ?? null };
}
export type TreeDrag = ReturnType<typeof useTreeDrag>;
