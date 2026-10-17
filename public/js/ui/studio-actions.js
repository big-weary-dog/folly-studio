// What the Studio does with the look as a whole: save it (or a copy of someone else's), share it, export it as
// JSON or as an xLights/FPP .fseq rendered in the sandbox, edit its details, and list my other looks in the
// phone's Look tab.
import { api } from '../api.js';
import { busy, confirmDialog, download, field, h, nextId, openDialog, slugify, toast } from './dom.js';

const FPS = 40;

// createActions({ S, ui, ctx, alive(), flush(), saveBody(), isDirty(), adoptServer(look), markDirty(),
//   updateSaveState(), preview, status }) → { save, setShared, exportFseq, exportJson, details, loadMyLooks,
//   showShared }
export function createActions(st) {
  const { S, ui, ctx } = st;
  const failed = (err, prefix = '') => {
    if (err.status === 401) return ctx.signedOut();
    toast(`${prefix}${err.message}`, { kind: 'error', timeout: prefix ? 8000 : undefined });
  };
  const showShared = (v) => { for (const s of ui.share) s.box.checked = !!v; };

  async function save() {
    if (!S.ready || S.saving) return;
    st.flush();
    const body = st.saveBody();
    const snap = JSON.stringify(body);
    const saving = (on) => { S.saving = on; busy(ui.saveBtn, on); st.updateSaveState(); };
    saving(true);
    try {
      let look;
      if (!S.look.id || S.copyOnSave) {
        const payload = { ...body };
        if (!payload.bpm) delete payload.bpm;
        if (S.look.ideaId && !S.copyOnSave) payload.ideaId = S.look.ideaId;
        ({ look } = await api.createLook(payload));
        const wasCopy = S.copyOnSave;
        S.copyOnSave = false;
        ui.notice.hidden = true;
        Object.assign(S.look, { owner: look.owner, ownerName: look.ownerName, shared: !!look.shared });
        showShared(S.look.shared);
        ctx.replaceUrl(`/studio/${encodeURIComponent(look.id)}`);
        toast(wasCopy ? 'Saved as your own copy.' : 'Saved.', { kind: 'ok' });
      } else {
        const hadBake = !!S.server?.bake;
        ({ look } = await api.updateLook(S.look.id, body));
        const cleared = hadBake && !look.bake;
        toast(cleared ? 'Saved. The old bake was cleared: bake again to check the new code.' : 'Saved.',
          { kind: 'ok', timeout: cleared ? 5000 : 1800 });
      }
      Object.assign(S.look, { id: look.id, title: body.title });
      S.saved = snap;
      st.adoptServer(look);
      ctx.setTitle(body.title);
    } catch (err) {
      failed(err, 'Could not save: ');
    } finally {
      saving(false);
    }
  }

  async function setShared(on) {
    if (S.copyOnSave) {
      showShared(false);
      toast('This look belongs to someone else. Save your own copy first, then share it.', { kind: 'warn' });
      return;
    }
    for (const s of ui.share) s.box.disabled = true;
    try {
      if (!S.look.id || st.isDirty()) await save();
      if (!S.look.id) return showShared(!on);
      const { look } = await api.updateLook(S.look.id, { shared: on });
      S.look.shared = !!look.shared;
      st.adoptServer(look);
      showShared(S.look.shared);
      toast(S.look.shared ? 'Shared to the gallery.' : 'Removed from the gallery.', { kind: 'ok' });
    } catch (err) {
      showShared(S.look.shared);
      failed(err);
    } finally {
      for (const s of ui.share) s.box.disabled = false;
    }
  }
  for (const s of ui.share) s.box.addEventListener('change', () => setShared(s.box.checked));

  async function exportFseq() {
    const { runtime } = st.preview;
    if (!runtime?.ready) return toast('The pattern engine is still starting.', { kind: 'warn' });
    st.flush();
    const paused = S.look.layers.filter((l) => st.status.of(l.id).kind === 'hung');
    if (paused.length) {
      const many = paused.length > 1;
      const names = paused.map((l) => `“${l.title}”`).join(', ');
      const why = `${names} ${many ? 'are' : 'is'} paused because ${many ? 'they' : 'it'} hung, so the export would `
        + `leave ${many ? 'them' : 'it'} out. Export the rest anyway?`;
      if (!(await confirmDialog(why, { title: 'A layer is paused', ok: 'Export anyway' }))) return;
    }
    const title = ui.titleInput.value.trim() || 'folly-look';
    await exportFseqDialog({ runtime, cathedral: S.cathedral, title, duration: S.look.duration });
    // An export can find a layer that hangs: show where things stand now, even when paused.
    if (st.alive()) { runtime.refresh(); st.preview.kick(); }
  }

  function exportJson() {
    st.flush();
    const { title, summary, layers, duration, bpm, globals, automation } = st.saveBody();
    const data = JSON.stringify({ title, summary, duration, ...(bpm ? { bpm } : {}), ...(globals ? { globals } : {}),
      ...(automation ? { automation } : {}), layers }, null, 2) + '\n';
    download(data, `${slugify(title, 'folly-look')}.json`, 'application/json');
  }

  function details() {
    openDialog({ title: 'Look details', build: (close) => {
      const t = h('input', { type: 'text', maxlength: 120, value: ui.titleInput.value });
      const s = h('textarea', { rows: 4, maxlength: 600, value: S.look.summary || '' });
      const submit = (e) => {
        e.preventDefault();
        ui.titleInput.value = S.look.title = t.value.trim() || 'Untitled look';
        S.look.summary = s.value.trim();
        st.markDirty();
        close(true);
      };
      return h('form', { class: 'details-form', onSubmit: submit },
        field('Title', t), field('Summary', s),
        S.look.ideaId ? h('p', { class: 'field-hint', text: 'Generated from one of your ideas.' }) : null,
        h('div', { class: 'dialog-actions' },
          h('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onClick: () => close(false) }),
          h('button', { type: 'submit', class: 'btn primary', text: 'Done' })));
    } });
  }

  let myLooksAt = 0;
  async function loadMyLooks() {
    if (Date.now() - myLooksAt < 15000) return;
    myLooksAt = Date.now();
    try {
      const { looks } = await api.looks('mine');
      const when = (l) => Date.parse(l.updatedAt || 0);
      const list = (looks || []).slice().sort((a, b) => when(b) - when(a));
      const link = (lk) => h('li', {}, h('a', { href: `/studio/${encodeURIComponent(lk.id)}`,
        'aria-current': lk.id === S.look.id ? 'page' : null, text: lk.title || 'Untitled look' }));
      ui.myLooks.replaceChildren(...(list.length ? list.slice(0, 8).map(link)
        : [h('li', { class: 'pane-hint', text: 'Nothing saved yet.' })]));
    } catch (err) {
      myLooksAt = 0;
      if (err.status === 401) ctx.signedOut();
    }
  }

  return { save, setShared, exportFseq, exportJson, details, loadMyLooks, showShared };
}

/** Squeeze full frames down to the ranged channels, in place (each frame moves left). */
function packFrames(channels, frames, frameSize, ranges) {
  let to = 0;
  for (let f = 0; f < frames; f++) {
    const base = f * frameSize;
    for (const [start, count] of ranges) { channels.copyWithin(to, base + start, base + start + count); to += count; }
  }
  return channels.subarray(0, to);
}

/** exportFseqDialog({ runtime, cathedral, title, duration (the default length, s) }) */
async function exportFseqDialog({ runtime, cathedral, title, duration = 30 }) {
  const { ledRanges, writeFseq } = await import('../fseq.js');
  const channelCount = (cathedral.universes || 80) * (cathedral.channelsPerUniverse || 510);
  const ranges = ledRanges(cathedral);
  const usedCount = ranges.reduce((n, r) => n + r[1], 0);
  let running = false;

  return openDialog({
    title: 'Export .fseq',
    className: 'export-dialog',
    onClose: () => { if (running) { running = false; runtime.cancelRender(); } },
    build(close) {
      const slider = (label, min, max, step, value) => {
        const id = nextId('ex');
        const input = h('input', { type: 'range', id, min, max, step, value });
        const out = h('output', { for: id });
        return { input, out, field: h('div', { class: 'field slider-field' }, h('label', { for: id, text: label }),
          input, out) };
      };
      // Defaults to the look's duration. Up to 2 minutes: the sandbox hands back full frames.
      const dur = slider('Duration', 1, 120, 0.25, Math.min(120, Math.max(1, duration)));
      const gamma = slider('Gamma', 1, 3, 0.1, 1), bright = slider('Brightness', 5, 100, 1, 100);
      const inputs = [dur.input, gamma.input, bright.input];
      const info = h('p', { class: 'export-info' });
      const bar = h('progress', { max: 1, value: 0, class: 'export-progress', hidden: true,
        'aria-label': 'Export progress' });
      const status = h('p', { class: 'export-status', role: 'status', 'aria-live': 'polite' });
      const go = h('button', { type: 'button', class: 'btn primary', text: 'Render & download' });
      const cancel = h('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onClick: () => close(false) });

      const sync = () => {
        const secs = +dur.input.value;
        dur.out.textContent = `${secs} s`;
        gamma.out.textContent = (+gamma.input.value).toFixed(1);
        bright.out.textContent = `${bright.input.value}%`;
        const frames = Math.round(secs * FPS);
        const mb = (frames * usedCount) / 1e6;
        info.textContent = `${frames.toLocaleString()} frames at ${FPS} fps · the ${usedCount.toLocaleString()} `
          + `channels the LEDs use, in ${ranges.length} sparse ranges of the ${channelCount.toLocaleString()}-channel `
          + `layout · about ${mb < 10 ? mb.toFixed(1) : mb.toFixed(0)} MB, uncompressed FSEQ v2.`;
      };
      for (const el of inputs) el.addEventListener('input', sync);
      sync();

      go.addEventListener('click', async () => {
        running = true;
        go.disabled = true;
        for (const el of inputs) el.disabled = true;
        const frames = Math.round(+dur.input.value * FPS);
        Object.assign(bar, { hidden: false, max: frames, value: 0 });
        status.textContent = 'Rendering…';
        const t0 = performance.now();
        try {
          const channels = await runtime.render({
            start: 0, frames, fps: FPS, gamma: +gamma.input.value, brightness: +bright.input.value / 100,
            onProgress: (done) => {
              bar.value = done;
              const pct = Math.round((done / frames) * 100);
              const eta = done > 0 ? ((performance.now() - t0) / 1000 / done) * (frames - done) : 0;
              const left = eta > 1 ? `, about ${Math.ceil(eta)} s left` : '';
              status.textContent = `Rendering… ${pct}% (${done.toLocaleString()} / ${frames.toLocaleString()} `
                + `frames${left})`;
            },
          });
          status.textContent = 'Writing the file…';
          const realFrames = Math.floor(channels.length / channelCount) || frames;
          const data = packFrames(channels, realFrames, channelCount, ranges);
          const bytes = writeFseq({ frames: realFrames, stepMs: 1000 / FPS, data, ranges });
          download(bytes, `${slugify(title, 'folly-look')}.fseq`);
          const size = `${(bytes.length / 1e6).toFixed(1)} MB`;
          toast(`Exported ${realFrames.toLocaleString()} frames (${size}).`, { kind: 'ok' });
          running = false;
          close(true);
        } catch (err) {
          running = false;
          status.textContent = err.message || String(err);
          status.classList.add('form-error');
          go.disabled = false;
          for (const el of inputs) el.disabled = false;
        }
      });

      const hint = '1.0 sends values as previewed. Use about 2.2 when the controller (FPP / the F48s) applies no '
        + 'gamma of its own, so the LEDs look like the screen.';
      return [h('div', { class: 'export-fields' }, dur.field, gamma.field, h('p', { class: 'field-hint', text: hint }),
        bright.field), info, bar, status, h('div', { class: 'dialog-actions' }, cancel, go)];
    },
  });
}
