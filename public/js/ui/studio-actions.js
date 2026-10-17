// What the Studio does with the look as a whole: save it (or a copy of someone else's), share it,
// export it as .fseq or JSON, edit its details, and list my other looks in the phone's Look tab.
import { api } from '../api.js';
import { busy, confirmDialog, field, h, openDialog, toast } from './dom.js';
import { exportFseqDialog, exportLookJson } from './export.js';

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

  const exportJson = () => { st.flush(); exportLookJson(st.saveBody()); };

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
