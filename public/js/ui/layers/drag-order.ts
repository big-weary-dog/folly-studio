// Drag to reorder a list (SPEC "Reorder"): a row's grip, pressed and dragged by any pointer (mouse, touch or pen),
// marks where the row will land; letting go there moves it as the row's up/down buttons would, one edit. Escape or a
// cancelled pointer puts it back. Only the grip takes the pointer (touch-action: none), so the list still scrolls.
import { useEffect, useRef, useState } from 'preact/hooks';

type Drag = { from: number, gap: number } | null;
const EDGE = 28;      // px from a scrolling pane's edge that scroll it while dragging
const STEP = 12;

/** For the rows of `list` in the order shown: the grip's handlers for row i, the landing mark for row i (`before` it,
 *  or `after` the last), and the row being dragged. `move(from, to)` is the row's index before and after. */
export function useDragOrder(list: { current: HTMLElement | null }, move: (from: number, to: number) => void) {
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
  /** Which gap between the rows the pointer is over: the count of rows whose top line's middle is above it (a row
   *  may hold more under its line: a module's open settings). */
  const gapAt = (y: number) => [...list.current?.children ?? []].filter((r) => {
    const b = (r.querySelector(':scope > :is(.chain-top, .layer-top)') ?? r).getBoundingClientRect();
    return b.top + b.height / 2 < y;
  }).length;
  const scroll = (y: number) => {
    const pane = list.current?.closest('.pane-body'), b = pane?.getBoundingClientRect();
    if (pane && b) pane.scrollTop += y < b.top + EDGE ? -STEP : y > b.bottom - EDGE ? STEP : 0;
  };
  const grip = (i: number) => ({
    onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      e.preventDefault();       // no text selection, no focus change
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      set({ from: i, gap: i });
    },
    onPointerMove(e: PointerEvent) {
      const d = live.current;
      if (!d) return;
      scroll(e.clientY);
      const gap = gapAt(e.clientY);
      if (gap !== d.gap) set({ ...d, gap });
    },
    onPointerUp() {
      const d = live.current;
      set(null);
      const to = d && (d.gap > d.from ? d.gap - 1 : d.gap);
      if (d && to !== d.from) move(d.from, to!);
    },
    onPointerCancel: () => set(null),
  });
  const still = !drag || drag.gap === drag.from || drag.gap === drag.from + 1;
  const drop = (i: number, n: number) => (still ? undefined : drag!.gap === i ? 'before'
    : drag!.gap === n && i === n - 1 ? 'after' : undefined);
  return { grip, drop, dragging: drag?.from };
}
