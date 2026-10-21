// Drag a module anywhere in a chain that holds composites (SPEC-library "Composites"): its grip, pressed and dragged
// by any pointer, marks the slot it will land in, in the layer's chain or any sub-layer's, so a module moves into a
// composite or out of one as it moves along a list. Slots are the elements marked `data-slot` ("comp sub index", or
// "- - index" for the layer's chain), in the order shown; letting go moves it, one edit. Escape puts it back.
import { useEffect, useRef, useState } from 'preact/hooks';

import type { Box } from './composite-model.ts';

type Drag = { id: string, slot: string | null } | null;
const EDGE = 28, STEP = 12;

/** A slot's key, for `data-slot`: where a module dropped there lands. */
export const slotKey = (box: Box, index: number) => `${box ? `${box.comp} ${box.sub}` : '- -'} ${index}`;
export const parseSlot = (key: string): [Box, number] => {
  const [comp, sub, i] = key.split(' ');
  return [comp === '-' ? null : { comp, sub: Number(sub) }, Number(i)];
};

/** `move(id, box, index)` lands module id at index of list box. → each grip's handlers, whether a slot is marked,
 * the module being dragged. */
export function useTreeDrag(root: { current: HTMLElement | null }, move: (id: string, box: Box, i: number) => void) {
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
  /** The first slot whose middle is below y (the last slot, the layer chain's end, when none is). */
  const slotAt = (y: number) => {
    const slots = [...root.current?.querySelectorAll<HTMLElement>('[data-slot]') ?? []];
    const hit = slots.find((s) => { const b = s.getBoundingClientRect(); return b.top + b.height / 2 > y; });
    return (hit ?? slots.at(-1))?.dataset.slot ?? null;
  };
  const scroll = (y: number) => {
    const pane = root.current?.closest('.pane-body'), b = pane?.getBoundingClientRect();
    if (pane && b) pane.scrollTop += y < b.top + EDGE ? -STEP : y > b.bottom - EDGE ? STEP : 0;
  };
  const grip = (id: string) => ({
    onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      set({ id, slot: null });
    },
    onPointerMove(e: PointerEvent) {
      const d = live.current;
      if (!d) return;
      scroll(e.clientY);
      const slot = slotAt(e.clientY);
      if (slot !== d.slot) set({ ...d, slot });
    },
    onPointerUp() {
      const d = live.current;
      set(null);
      if (d?.slot) move(d.id, ...parseSlot(d.slot));
    },
    onPointerCancel: () => set(null),
  });
  return { grip, marked: (box: Box, i: number) => drag?.slot === slotKey(box, i), dragging: drag?.id ?? null };
}
export type TreeDrag = ReturnType<typeof useTreeDrag>;
