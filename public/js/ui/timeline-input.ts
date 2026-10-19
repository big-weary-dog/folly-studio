// Pointer, wheel and keys on the timeline. Wide: drag a clip to move it, its edges to trim, its top-corner handles to
// fade; double-click a row to add a clip; drag the ruler to scrub; Ctrl/⌘-wheel zooms. On a phone a tap only
// selects, and the numbers below the strips do the editing.
import type { Clip } from '../../../shared/schemas/look.ts';
import type { Studio } from './studio-store.ts';
import { fadeClip, GRID, moveClip, trimClip } from './timeline-model.ts';
import type { TimelineState } from './timeline-state.ts';

const EDGE_PX = 7;          // grab an edge this close to it
const DEAD_PX = 3;          // movement before a press becomes a drag
const LIVE_MS = 90;         // mid-drag, the look (and the preview) catches up this often

type Kind = 'move' | 'start' | 'end' | 'in' | 'out';

export function attachInput(sc: HTMLElement, tl: TimelineState, st: Studio) {
  let drag: { kind: Kind; id: string; index: number; x0: number; clips: Clip[]; moved: boolean } | null = null;
  let scrub: { left: number } | null = null, lastLive = 0;
  const wide = () => !st.narrow.peek();
  const seekAt = (x: number) => tl.seek((x - (scrub?.left || 0) + (wide() ? sc.scrollLeft : 0)) / tl.pps.peek());

  function onDown(e: PointerEvent) {
    const t = e.target as HTMLElement;
    if (e.button !== 0 || t.closest('.tl-name')) return;
    const ruler = t.closest('.tl-ruler') as HTMLElement | null;
    if (ruler) {
      scrub = { left: (ruler.querySelector('canvas') as HTMLElement).getBoundingClientRect().left };
      ruler.setPointerCapture(e.pointerId);
      seekAt(e.clientX);
      e.preventDefault();
      return;
    }
    const row = t.closest('.tl-row:not(.tl-auto-row)') as HTMLElement | null;
    const layer = row && tl.layer(row.dataset.id || '');
    if (!layer) return;
    const clipEl = t.closest('.tl-clip') as HTMLElement | null;
    if (!clipEl) return tl.selectClip(layer.id, null);
    const index = Number(clipEl.dataset.i);
    tl.selectClip(layer.id, index, { focus: true });
    if (!wide()) return;
    const rect = clipEl.getBoundingClientRect(), handle = t.closest('.tl-fh');
    let kind: Kind = 'move';
    if (handle) kind = handle.classList.contains('tl-fh-in') ? 'in' : 'out';
    else if (e.clientX - rect.left <= EDGE_PX && rect.width > 3 * EDGE_PX) kind = 'start';
    else if (rect.right - e.clientX <= EDGE_PX) kind = 'end';
    drag = { kind, id: layer.id, index, x0: e.clientX, clips: (layer.clips || []).slice(), moved: false };
    clipEl.setPointerCapture(e.pointerId);
    e.preventDefault();          // no text selection; focus was set above
  }

  function onMove(e: PointerEvent) {
    if (scrub) { seekAt(e.clientX); return; }
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) < DEAD_PX) return;
    drag.moved = true;
    const { clips, index: i } = drag, c = clips[i], dt = dx / tl.pps.peek();
    const step = e.altKey ? 0 : tl.step(), limit = tl.limit(c);     // Alt: no snapping
    const next = drag.kind === 'move' ? moveClip(clips, i, c.start + dt, step, limit)
      : drag.kind === 'start' ? trimClip(clips, i, 'start', c.start + dt, step, limit)
      : drag.kind === 'end' ? trimClip(clips, i, 'end', c.end + dt, step, limit)
      : drag.kind === 'in' ? fadeClip(clips, i, 'in', c.fadeIn + dt, step)
      : fadeClip(clips, i, 'out', c.fadeOut - dt, step);
    tl.drag.value = { id: drag.id, clips: next };
    const now = performance.now();
    if (now - lastLive >= LIVE_MS) { lastLive = now; tl.setClips(drag.id, next); }
  }

  function onUp() {
    if (scrub) { scrub = null; return; }
    const d = drag, shown = tl.drag.peek();
    drag = null;
    tl.drag.value = null;
    if (d?.moved && shown) tl.setClips(d.id, shown.clips);
  }

  function onDouble(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (!wide() || t.closest('.tl-clip, .tl-name')) return;
    const lane = t.closest('.tl-lane') as HTMLElement | null;
    const layer = lane && tl.layer((lane.parentElement as HTMLElement).dataset.id || '');
    if (layer) tl.addClipAt(layer, (e.clientX - lane.getBoundingClientRect().left) / tl.pps.peek());
  }

  function onWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey) || !wide()) return;
    e.preventDefault();
    const x = e.clientX - sc.getBoundingClientRect().left - tl.namesW.peek();
    tl.zoom(Math.exp(-e.deltaY * 0.0015), Math.max(0, x));
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;
    const s = tl.selected.peek();
    if (!s) return;
    const clips = s.layer.clips || [];
    if (e.key === 'Escape') {
      e.preventDefault();
      tl.selectClip(s.layer.id, null);
      sc.focus({ preventScroll: true });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      tl.removeSelected();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const by = (e.key === 'ArrowLeft' ? -1 : 1) * (tl.step() || GRID), limit = tl.limit(s.clip);
      tl.setClips(s.layer.id, e.shiftKey ? trimClip(clips, s.index, 'end', s.clip.end + by, 0, limit)
        : moveClip(clips, s.index, s.clip.start + by, 0, limit));
      tl.focusClip(s.layer.id, s.index);
    }
  }

  const on: [string, EventListener, AddEventListenerOptions?][] = [['pointerdown', onDown as EventListener],
    ['pointermove', onMove as EventListener], ['pointerup', onUp], ['pointercancel', onUp],
    ['dblclick', onDouble as EventListener], ['wheel', onWheel as EventListener, { passive: false }],
    ['keydown', onKey as EventListener]];
  for (const [type, fn, opts] of on) sc.addEventListener(type, fn, opts);
  return () => { for (const [type, fn] of on) sc.removeEventListener(type, fn); };
}
