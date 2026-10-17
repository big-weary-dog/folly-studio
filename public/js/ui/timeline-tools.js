// The timeline's controls: length and tempo, snapping, zoom, adding a clip, importing a look, and the
// selected clip's numbers (wide: in the dock's head, in place of length and tempo; phones: below the strips).
import { h, nextId } from './dom.js';
import { cleanBpm, cleanDuration, editClip, MAX_DURATION } from './timeline-model.js';

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
    title: 'Import a look: play another look after this one', onClick: () => tl.host.onImport() });

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
    for (const [key, f] of Object.entries(fields)) {
      f.input.disabled = !s;
      set(f.input, s ? s.clip[key] : null);
    }
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
