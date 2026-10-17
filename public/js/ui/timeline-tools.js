// Editing the timeline. Its controls: length and tempo, snapping, zoom, adding a clip, importing a look, and the
// selected clip's numbers (wide: in the dock's head, in place of length and tempo; phones: below the strips);
// "Import look…" picks one of my looks or a gallery look to play after this one (Timeline.importLook sequences it).
// Pointer, wheel and keys: wide, drag a clip to move it, its edges to trim, its top-corner handles to fade;
// double-click a row to add a clip; drag the ruler to scrub; Ctrl/⌘-wheel zooms. On a phone a tap only selects,
// and the numbers below the strips do the editing.
import { api } from '../api.js';
import { h, nextId, openDialog } from './dom.js';
import {
  cleanBpm, cleanDuration, clock, DEFAULT_DURATION, editClip, fadeClip, GRID, MAX_DURATION, moveClip, trimClip,
} from './timeline-model.js';

const SNAPS = [{ value: 'grid', label: 'Snap ¼ s' }, { value: 'beat', label: 'Snap beats' },
  { value: 'off', label: 'No snap' }];

/** A labelled number box: [label input unit]. */
function numberField(label, unit, attrs, labelClass = 'tl-label') {
  const id = nextId('tln');
  const input = h('input', { id, type: 'number', class: 'tl-num', inputmode: 'decimal', ...attrs });
  return { input, field: h('span', { class: 'tl-field' }, h('label', { for: id, class: labelClass, text: label }),
    input, unit ? h('span', { class: 'tl-unit', text: unit }) : null) };
}

const show = (v) => (v === null || v === undefined ? '' : String(Math.round(v * 1000) / 1000));

export function buildTools(tl) {
  const length = numberField('Length', 's', { min: 1, max: MAX_DURATION, step: 0.25,
    title: 'How long the look runs before it loops, in seconds' });
  const tempo = numberField('BPM', '', { min: 40, max: 240, step: 1, placeholder: 'BPM',
    title: 'Tempo in beats per minute, for the beat grid (optional)' });
  const snapSel = h('select', { class: 'tl-snap', 'aria-label': 'Snapping' },
    SNAPS.map((s) => h('option', { value: s.value, text: s.label })));
  const btn = (text, label, onClick, cls = 'tl-btn') =>
    h('button', { type: 'button', class: cls, text, 'aria-label': label, title: label, onClick });
  const zoom = h('span', { class: 'tl-zoom', role: 'group', 'aria-label': 'Zoom' },
    btn('−', 'Zoom out (Ctrl+wheel)', () => tl.zoom(1 / 1.6)),
    btn('+', 'Zoom in (Ctrl+wheel)', () => tl.zoom(1.6)),
    btn('Fit', 'Fit the whole look', () => tl.zoomToFit(), 'tl-btn tl-fit'));
  const addBtn = h('button', { type: 'button', class: 'btn small tl-add', text: '+ Clip',
    title: 'Add a clip to the selected layer at the playhead',
    onClick: () => tl.addClipAt(tl.layerById(tl.host.selectedId()), tl.host.time()) });
  const importBtn = h('button', { type: 'button', class: 'btn small tl-import', text: 'Import look…',
    title: 'Import a look: play another look after this one', onClick: () => importLookDialog(tl) });

  // The selected clip's numbers.
  const secs = (label) => numberField(label, '', { min: 0, max: MAX_DURATION, step: 0.05,
    title: `${label}, in seconds` }, 'tl-label keep');
  const [start, end, fadeIn, fadeOut] = ['Start', 'End', 'Fade in', 'Fade out'].map(secs);
  const clipName = h('span', { class: 'tl-clip-name' });
  const delBtn = btn('Remove', 'Remove this clip (Delete)', () => tl.removeSelected(), 'tl-btn tl-del');
  const doneBtn = btn('Done', 'Done with this clip (Esc)', () => {
    const s = tl.selected();
    if (s) tl.selectClip(s.layer.id, null);
  }, 'tl-btn tl-done');
  const inspector = h('div', { class: 'tl-inspector', role: 'group', 'aria-label': 'Selected clip' },
    clipName, start.field, end.field, fadeIn.field, fadeOut.field, delBtn, doneBtn);
  const viewTools = h('span', { class: 'tl-view-tools' }, snapSel, zoom, addBtn);
  const lookTools = h('span', { class: 'tl-look-tools' }, length.field, tempo.field, importBtn);
  const el = h('div', { class: 'tl-tools' }, lookTools, viewTools);

  length.input.addEventListener('change', () => {
    const d = cleanDuration(length.input.value);
    if (d !== tl.duration) tl.setDuration(d); else length.input.value = show(d);
  });
  tempo.input.addEventListener('change', () => {
    const typed = tempo.input.value.trim();
    const bpm = cleanBpm(typed);
    if (typed && !bpm) { tempo.input.value = show(tl.look.bpm); return; }
    if (bpm !== (tl.look.bpm || null)) tl.setBpm(bpm);
  });
  snapSel.addEventListener('change', () => tl.setSnap(snapSel.value));
  const fields = { start, end, fadeIn, fadeOut };
  for (const [key, f] of Object.entries(fields)) {
    f.input.addEventListener('change', () => {
      const s = tl.selected();
      if (!s) return;
      const next = editClip(s.layer.clips, s.index, { [key]: +f.input.value }, tl.limit(s.clip));
      if (next) tl.setClips(s.layer, next); else update();
    });
  }
  for (const input of [length.input, tempo.input, ...Object.values(fields).map((f) => f.input)]) {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  }

  /** Mirror the look and the selection. Never overwrites a box being typed in. */
  function update() {
    const set = (input, v) => { if (document.activeElement !== input) input.value = show(v); };
    set(length.input, tl.duration);
    set(tempo.input, tl.look.bpm ?? null);
    snapSel.querySelector('[value=beat]').disabled = !tl.look.bpm;
    if (snapSel.value !== tl.snapMode) snapSel.value = tl.snapMode;
    const layer = tl.layerById(tl.host.selectedId());
    addBtn.disabled = !layer;
    const s = tl.selected();
    el.classList.toggle('has-clip', !!s);
    inspector.classList.toggle('none', !s);
    for (const [key, f] of Object.entries(fields)) { f.input.disabled = !s; set(f.input, s ? s.clip[key] : null); }
    delBtn.disabled = doneBtn.disabled = !s;
    clipName.textContent = s
      ? `${s.layer.title || 'Layer'} · clip ${s.index + 1}/${s.layer.clips.length}`
      : layer ? `${layer.title || 'Layer'}: tap a clip to edit it` : 'No layer selected';
  }

  /** Phones: adding a clip sits with the clip's numbers (there is no dragging to snap). */
  function place(narrow) {
    if (narrow) inspector.insertBefore(addBtn, delBtn); else viewTools.append(addBtn);
  }

  return { el, inspector, update, place };
}

const SCOPES = { mine: 'My looks', gallery: 'Gallery' };

/** The picker; this look is listed last (importing it repeats it). */
function importLookDialog(tl) {
  const currentId = tl.look.id;
  return openDialog({ title: 'Import a look', className: 'import-dialog', build(close) {
    const list = h('ul', { class: 'library-list import-list', 'aria-live': 'polite' });
    const status = h('p', { class: 'import-status', role: 'status' });
    const hint = (text) => list.replaceChildren(h('li', { class: 'pane-hint', text }));
    const cache = new Map();
    const tabs = Object.entries(SCOPES).map(([scope, text]) => h('button', { type: 'button', class: 'tab import-tab',
      dataset: { scope }, text, 'aria-pressed': 'false', onClick: () => show(scope) }));
    /** api call → its result, or null after saying why (a 401 signs out). */
    const ask = (call, said) => call.catch((err) => {
      if (err.status === 401) { close(false); tl.host.signedOut(); } else said(err.message);
      return null;
    });

    async function show(scope) {
      for (const t of tabs) t.setAttribute('aria-pressed', String(t.dataset.scope === scope));
      status.textContent = '';
      hint('Loading…');
      const looks = cache.get(scope) || (await ask(api.looks(scope), hint))?.looks;
      if (!looks) return;
      cache.set(scope, looks);
      const sorted = looks.filter((l) => l.id !== currentId).concat(looks.filter((l) => l.id === currentId));
      if (!sorted.length) return hint(scope === 'mine' ? 'You have no saved looks yet.' : 'The gallery is empty.');
      list.replaceChildren(...sorted.map((look) => {
        const n = look.layerCount;     // lists carry metadata only
        const meta = `${n} layer${n === 1 ? '' : 's'} · ${clock(look.duration || DEFAULT_DURATION)}`
          + `${look.id === currentId ? ' · this look (saved version)' : ''}`
          + `${scope === 'gallery' && look.ownerName ? ` · by ${look.ownerName}` : ''}`;
        return h('li', {}, h('button', { type: 'button', class: 'library-item', onClick: () => pick(look) },
          h('span', { class: 'library-title', text: look.title || 'Untitled look' }),
          h('span', { class: 'library-summary', text: meta })));
      }));
    }

    async function pick(look) {
      const full = (await ask(api.look(look.id), (m) => { status.textContent = m; }))?.look;
      const error = full && tl.importLook(full);
      if (error) status.textContent = error; else if (full) close(true);
    }

    show('mine');
    return [
      h('p', { class: 'dialog-text', text: 'Its layers are added to this look, each with a clip that starts where '
        + 'this look’s content ends. Layers here that play throughout end there, so the two follow each other.' }),
      h('div', { class: 'import-tabs', role: 'group', 'aria-label': 'Which looks' }, tabs), list, status,
    ];
  } });
}

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
