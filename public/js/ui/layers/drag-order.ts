// Drag to reorder a list (SPEC "Reorder"): a row's grip (grip-drag.ts) marks where the row will land; letting go there
// moves it as the row's up/down buttons would, one edit.
import { useGripDrag } from '../grip-drag.ts';

type Drag = { from: number, gap: number };

/** For the rows of `list` in the order shown: the grip's handlers for row i, the landing mark for row i (`before` it,
 *  or `after` the last), and the row being dragged. `move(from, to)` is the row's index before and after. */
export function useDragOrder(list: { current: HTMLElement | null }, move: (from: number, to: number) => void) {
  const { drag, grip: handlers } = useGripDrag<Drag>(list);
  /** Which gap between the rows the pointer is over: the count of rows whose top line's middle is above it (a row
   *  may hold more under its line: a module's open settings). */
  const gapAt = (y: number) => [...list.current?.children ?? []].filter((r) => {
    const b = (r.querySelector(':scope > :is(.chain-top, .layer-top)') ?? r).getBoundingClientRect();
    return b.top + b.height / 2 < y;
  }).length;
  const grip = (i: number) => handlers({ from: i, gap: i }, (d, y) => {
    const gap = gapAt(y);
    return gap === d.gap ? d : { ...d, gap };
  }, (d) => {
    const to = d.gap > d.from ? d.gap - 1 : d.gap;
    if (to !== d.from) move(d.from, to);
  });
  const still = !drag || drag.gap === drag.from || drag.gap === drag.from + 1;
  const drop = (i: number, n: number) => (still ? undefined : drag!.gap === i ? 'before'
    : drag!.gap === n && i === n - 1 ? 'after' : undefined);
  return { grip, drop, dragging: drag?.from };
}
