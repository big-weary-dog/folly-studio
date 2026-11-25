// Dragging by a grip (SPEC "Reorder"): pressed and dragged by any pointer (mouse, touch or pen), the pointer held by
// the grip; the pane that scrolls round the list scrolls near its edges; letting go drops, Escape or a cancelled
// pointer puts it back. Only the grip takes the pointer (touch-action: none), so the list still scrolls.
import { useEffect, useRef, useState } from 'preact/hooks';

const EDGE = 28;      // px from a scrolling pane's edge that scroll it while dragging
const STEP = 12;

/** The nearest element round `e` that scrolls (the pane's body; on a phone, the side panel). */
function scroller(e: Element | null) {
  for (let x = e; x; x = x.parentElement) {
    const o = getComputedStyle(x).overflowY;
    if ((o === 'auto' || o === 'scroll') && x.scrollHeight > x.clientHeight) return x;
  }
  return null;
}

/** A drag inside `root`, as D: `grip(start, at, drop)` gives a grip's handlers, where `at(d, y)` is the drag with the
 * pointer at y (d itself when nothing changed) and `drop(d)` lands it; `drag` is the one in progress. */
export function useGripDrag<D extends object>(root: { current: HTMLElement | null }) {
  const [drag, show] = useState<D | null>(null);
  const live = useRef<D | null>(null);
  const set = (d: D | null) => { live.current = d; show(d); };
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
  const scroll = (y: number) => {
    const pane = scroller(root.current), b = pane?.getBoundingClientRect();
    if (pane && b) pane.scrollTop += y < b.top + EDGE ? -STEP : y > b.bottom - EDGE ? STEP : 0;
  };
  const grip = (start: D, at: (d: D, y: number) => D, drop: (d: D) => void) => ({
    onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      e.preventDefault();       // no text selection, no focus change
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      set(start);
    },
    onPointerMove(e: PointerEvent) {
      const d = live.current;
      if (!d) return;
      scroll(e.clientY);
      const next = at(d, e.clientY);
      if (next !== d) set(next);
    },
    onPointerUp() {
      const d = live.current;
      set(null);
      if (d) drop(d);
    },
    onPointerCancel: () => set(null),
  });
  return { drag, grip };
}
