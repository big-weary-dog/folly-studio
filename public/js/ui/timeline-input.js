// Editing the timeline by pointer, wheel and keys. Wide: drag a clip to move it, its edges to trim, its
// top-corner handles to fade; double-click a row to add a clip; drag the ruler to scrub; Ctrl/⌘-wheel
// zooms. On a phone a tap only selects, and the numbers below the strips do the editing.
import { fadeClip, GRID, moveClip, trimClip } from './timeline-model.js';

const EDGE_PX = 7;          // grab an edge this close to it
const DEAD_PX = 3;          // movement before a press becomes a drag
const LIVE_MS = 90;         // mid-drag, the preview catches up this often

export function attachInput(tl) {
  const sc = tl.scroll;
  let drag = null, scrub = null, lastLive = 0;

  const seekAt = (clientX) => {
    const t = (clientX - scrub.left + (tl.mode === 'wide' ? tl.scrollX : 0)) / tl.pps;
    tl.host.onSeek(Math.max(0, Math.min(tl.duration, t)));
  };

  function onDown(e) {
    if (e.button !== 0 || e.target.closest('.tl-name')) return;
    if (e.target.closest('.tl-ruler')) {
      scrub = { left: tl.canvas.getBoundingClientRect().left, id: e.pointerId };
      tl.ruler.setPointerCapture(e.pointerId);
      seekAt(e.clientX);
      e.preventDefault();
      return;
    }
    const row = e.target.closest('.tl-row');
    const layer = row && tl.layerById(row.dataset.id);
    if (!layer) return;
    const clipEl = e.target.closest('.tl-clip');
    if (!clipEl) return tl.selectClip(layer.id, null);
    const index = +clipEl.dataset.i;
    tl.selectClip(layer.id, index, { focus: true });
    if (tl.mode !== 'wide') return;
    const rect = clipEl.getBoundingClientRect();
    const handle = e.target.closest('.tl-fh');
    let kind = 'move';
    if (handle) kind = handle.classList.contains('tl-fh-in') ? 'in' : 'out';
    else if (e.clientX - rect.left <= EDGE_PX && rect.width > 3 * EDGE_PX) kind = 'start';
    else if (rect.right - e.clientX <= EDGE_PX) kind = 'end';
    drag = { kind, layer, index, x0: e.clientX, clips: layer.clips.slice(), clip: layer.clips[index],
      moved: false };
    clipEl.setPointerCapture(e.pointerId);
    e.preventDefault();          // no text selection; focus was set above
  }

  function onMove(e) {
    if (scrub) { seekAt(e.clientX); return; }
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) < DEAD_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      tl.dragging = true;
      tl.el.classList.add('dragging');
    }
    const { clips, index: i, clip: c } = drag;
    const dt = dx / tl.pps;
    const step = e.altKey ? 0 : tl.step();         // Alt: no snapping
    const limit = tl.limit(c);
    let next;
    if (drag.kind === 'move') next = moveClip(clips, i, c.start + dt, step, limit);
    else if (drag.kind === 'start') next = trimClip(clips, i, 'start', c.start + dt, step, limit);
    else if (drag.kind === 'end') next = trimClip(clips, i, 'end', c.end + dt, step, limit);
    else if (drag.kind === 'in') next = fadeClip(clips, i, 'in', c.fadeIn + dt, step);
    else next = fadeClip(clips, i, 'out', c.fadeOut - dt, step);
    const now = performance.now();
    const live = now - lastLive >= LIVE_MS;
    if (live) lastLive = now;
    tl.setClips(drag.layer, next, { notify: live ? 'live' : 'none' });
  }

  function onUp() {
    if (scrub) { scrub = null; return; }
    if (!drag) return;
    const d = drag;
    drag = null;
    tl.dragging = false;
    tl.el.classList.remove('dragging');
    if (d.moved) tl.setClips(d.layer, d.layer.clips || [], { notify: 'commit' });
  }

  function onDouble(e) {
    if (tl.mode !== 'wide' || e.target.closest('.tl-clip, .tl-name')) return;
    const lane = e.target.closest('.tl-lane');
    const layer = lane && tl.layerById(lane.parentElement.dataset.id);
    if (!layer) return;
    tl.addClipAt(layer, (e.clientX - lane.getBoundingClientRect().left) / tl.pps);
  }

  function onWheel(e) {
    if (!(e.ctrlKey || e.metaKey) || tl.mode !== 'wide') return;
    e.preventDefault();
    const x = e.clientX - sc.getBoundingClientRect().left - tl.namesW;
    tl.zoom(Math.exp(-e.deltaY * 0.0015), Math.max(0, x));
  }

  function onKey(e) {
    if (e.target.closest('input, select, textarea')) return;
    const s = tl.selected();
    if (!s) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      tl.selectClip(s.layer.id, null);
      sc.focus({ preventScroll: true });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      tl.removeSelected();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const by = (e.key === 'ArrowLeft' ? -1 : 1) * (tl.step() || GRID);
      const limit = tl.limit(s.clip);
      const next = e.shiftKey
        ? trimClip(s.layer.clips, s.index, 'end', s.clip.end + by, 0, limit)
        : moveClip(s.layer.clips, s.index, s.clip.start + by, 0, limit);
      tl.setClips(s.layer, next);
      tl.clipEl(s.layer.id, s.index)?.focus({ preventScroll: true });
    }
  }

  const on = [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp],
    ['dblclick', onDouble], ['wheel', onWheel, { passive: false }], ['keydown', onKey]];
  for (const [type, fn, opts] of on) sc.addEventListener(type, fn, opts);
  return () => { for (const [type, fn] of on) sc.removeEventListener(type, fn); };
}
