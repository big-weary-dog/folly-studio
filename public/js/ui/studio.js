// The Studio: groups tree · 3D view + transport · layer stack + params · code editor and timeline.
// This module holds the look and wires the panels: studio-layout.js builds them, studio-status.js
// tracks what the sandbox says about each layer, studio-preview.js runs the 3D view and the clock,
// and studio-actions.js saves, shares and exports.
import { api } from '../api.js';
import { BakePanel } from './bake.js';
import { clear, debounce, h, isTyping, pref, randomId, reducedMotion, stylesheet, toast } from './dom.js';
import { CodeEditor } from './editor.js';
import { GroupsTree } from './groups.js';
import { LayerStack } from './layers.js';
import {
  buildGroupIndex, BLANK_CODE, cleanLayer, layerFromPattern, loadCathedral, loadLibrary, makeLayer, normaliseLayers,
} from './model.js';
import { ParamsPanel } from './params.js';
import { quickReference } from './reference.js';
import { createActions } from './studio-actions.js';
import { createLayerOps } from './studio-layers.js';
import { buildLayout, TABS } from './studio-layout.js';
import { createPreview } from './studio-preview.js';
import { createLayerStatus, ISSUE_LABELS } from './studio-status.js';
import { Timeline } from './timeline.js';
import { importLookDialog } from './timeline-import.js';
import { cleanBpm, cleanDuration } from './timeline-model.js';

await stylesheet('/css/studio.css');

const NARROW = '(max-width: 899px)';
const COMPILE_DELAY_MS = 300;

export function mount(root, ctx) {
  ctx.setTitle('Studio');
  const me = ctx.user;
  let alive = true;
  const S = {
    look: { id: null, title: 'Untitled look', summary: '', layers: [], duration: 30, bpm: null, shared: false,
      ideaId: null, owner: me?.id, ownerName: me?.username, reviewed: false, bake: null },
    server: null,              // the look as the server last sent it (bake, reviewed, …), null until saved
    baked: null,               // { frames, rgb, index } while the preview plays baked frames
    cathedral: null, index: null, library: [], copyOnSave: false, selectedId: null, saved: '', muted: new Set(),
    solo: new Set(), playing: !reducedMotion(), t: 0, speed: 1, hoverGroup: null, pinnedGroup: null, saving: false,
    ready: false, dirty: false,
  };
  const narrowMq = matchMedia(NARROW);
  const layerById = (id) => S.look.layers.find((l) => l.id === id) || null;
  const selected = () => layerById(S.selectedId);
  const toggleSet = (set, id) => (set.has(id) ? set.delete(id) : set.add(id));
  const silent = (id) => S.muted.has(id) || (S.solo.size > 0 && !S.solo.has(id));
  const groupNames = (ids) => (ids && ids.length ? ids.map((id) => S.index?.byId.get(id)?.name || id).join(', ')
    : 'Whole cathedral');

  const st = { S, ctx, isDirty, saveBody, adoptServer, markDirty, alive: () => alive };
  st.flush = () => compileSoon.flush();
  const menu = { exportFseq: () => actions.exportFseq(), exportJson: () => actions.exportJson(),
    details: () => actions.details() };
  const ui = st.ui = buildLayout({ store: pref, tab: pref('studio.tab') || 'layers', setTab, actions: menu });
  const actions = createActions(st);
  root.append(ui.studio);
  setTab(ui.studio.dataset.tab);
  const status = st.status = createLayerStatus({ layerById, silent });

  // Bake card: under the groups tree on a wide screen, in the Look tab on a phone.
  const bakePanel = new BakePanel(ui.bakeSlotWide, { user: me, host: {
    look: () => (S.look.id && S.server ? { ...S.server, id: S.look.id } : null),
    dirty: () => isDirty(),
    save: async () => { await actions.save(); return !!S.look.id && !isDirty(); },
    setLook: (look) => { adoptServer(look); bakePanel.render(); },
    playBaked: (on) => preview.playBaked(on),
    signedOut: () => ctx.signedOut(),
  } });
  const timeline = new Timeline({
    toolsSlot: ui.dock.toolsSlot, layers: () => S.look.layers, look: () => S.look, selectedId: () => S.selectedId,
    time: () => S.t, onSelectLayer: (id) => select(id),
    onEdit: ({ live }) => {        // clips, the length or the tempo (live: mid-drag, only the preview catches up)
      S.look.duration = cleanDuration(S.look.duration);
      if (S.t >= S.look.duration) S.t %= S.look.duration;
      if (live) { pushLook(); markDirty(); } else changed();
    },
    onSeek: (t) => { S.t = t; preview.kick(); },
    onImport: () => importLookDialog({ currentId: S.look.id, signedOut: () => ctx.signedOut(),
      onPick: (look) => timeline.importLook(look, () => randomId('l')) }),
  });
  const preview = st.preview = createPreview({
    S, ui, timeline, alive: () => alive, signedOut: () => ctx.signedOut(),
    onCompiled: (layers) => { if (status.compiled(layers)) pushLook(); refresh(); },
    onFrameErrors: (errors) => { if (status.frameErrors(errors)) refresh(); },
    onBaked: (on) => bakePanel.setPlaying(on),
  });
  // Bake card and timeline: where they go depends on the screen.
  const placePanels = () => {
    const narrow = narrowMq.matches;
    (narrow ? ui.bakeSlotNarrow : ui.bakeSlotWide).append(bakePanel.el);
    (narrow ? ui.timeBody : ui.dock.timelineBody).append(timeline.el);
    timeline.setMode(narrow);
  };
  placePanels();
  narrowMq.addEventListener('change', placePanels);

  const stack = new LayerStack(ui.layersBody, {
    onSelect: (id) => select(id),
    onChange: (id, patch) => { const l = layerById(id); if (!l) return; Object.assign(l, patch); changed(); },
    onToggleMute: (id) => { toggleSet(S.muted, id); changed({ dirty: false }); },
    onToggleSolo: (id) => { toggleSet(S.solo, id); changed({ dirty: false }); },
  });
  const setParams = (fn) => {
    const l = selected();
    if (!l) return;
    l.params = fn({ ...l.params });
    changed({ stack: false });
  };
  const params = new ParamsPanel(ui.paramsBody, {
    onChange: (key, value) => setParams((p) => ({ ...p, [key]: value })),
    onReset: (key) => setParams((p) => { delete p[key]; return p; }),
    onResetAll: () => setParams(() => ({})),
  });
  const editor = new CodeEditor(ui.dock.codeBody, {
    onInput: (code) => { const l = selected(); if (!l) return; l.code = code; markDirty(); compileSoon(); },
    onSave: () => actions.save(),
  });
  ui.dock.codeBody.append(quickReference((text) => editor.insert(text)));
  const compileSoon = debounce(() => { pushLook(); refresh(); }, COMPILE_DELAY_MS);
  let groupsTree = null;

  preview.showMsg('Loading the cathedral…');
  const library = loadLibrary().catch((err) => {
    toast(`Library unavailable: ${err.message}`, { kind: 'error' });
    return [];
  });
  Promise.all([loadCathedral(), library, loadLook()]).then(([cathedral, lib, look]) => {
    if (!alive) return;
    Object.assign(S, { cathedral, index: buildGroupIndex(cathedral), library: lib });
    setupLook(look);
    preview.start(cathedral);
    pushLook();
    groupsTree = new GroupsTree(ui.groupsBody, cathedral, S.index, {
      onToggle: (id, checked) => toggleGroup(id, checked),
      onHover: (id) => { S.hoverGroup = id; updateHighlight(); },
      onPin: (id) => { S.pinnedGroup = id; updateHighlight(); },
    });
    S.ready = true;
    bakePanel.render();
    select(S.look.layers.length ? S.look.layers[S.look.layers.length - 1].id : null);
    preview.kick();
  }).catch((err) => {
    if (!alive) return;
    if (err.status === 401) return ctx.signedOut();
    preview.showMsg(`Could not open the Studio: ${err.message}`, true);
    toast(err.message, { kind: 'error' });
  });

  async function loadLook() {
    const id = ctx.params.lookId;
    if (!id) return null;
    try {
      return (await api.look(id)).look;
    } catch (err) {
      if (err.status === 401) throw err;
      const gone = 'That look was not found (or is not shared). Starting a new one.';
      toast(err.status === 404 ? gone : err.message, { kind: 'error' });
      ctx.replaceUrl('/studio');
      return null;
    }
  }

  function setupLook(look) {
    if (look) {
      Object.assign(S.look, {
        id: look.id, title: look.title || 'Untitled look', summary: look.summary || '', shared: !!look.shared,
        layers: normaliseLayers(look.layers, S.cathedral), ideaId: look.ideaId || null, owner: look.owner,
        ownerName: look.ownerName, duration: cleanDuration(look.duration), bpm: cleanBpm(look.bpm),
        reviewed: false, bake: null,
      });
      S.copyOnSave = !!(me && look.owner && look.owner !== me.id);
      S.server = look;
      ctx.setTitle(S.look.title);
    } else {
      const first = S.library[0];
      S.look.layers = [first ? layerFromPattern(first, S.cathedral)
        : makeLayer({ title: 'Rising band', code: BLANK_CODE }, S.cathedral)];
    }
    if (!S.look.layers.length) S.look.layers.push(makeLayer({ title: 'Rising band' }, S.cathedral));
    ui.titleInput.value = S.look.title;
    S.saved = snapshot();     // untouched: even a brand-new look only nags once edited
    actions.showShared(S.look.shared && !S.copyOnSave);
    if (S.copyOnSave) {
      clear(ui.notice).append(h('strong', { text: 'From the gallery' }),
        ` — “${S.look.title}” by ${S.look.ownerName || 'someone else'}. `
        + 'Play with it freely; Save makes your own copy.');
      ui.notice.hidden = false;
    }
    updateSaveState();
  }

  /** The look as saved: what save() sends and what isDirty() compares. */
  function saveBody() {
    return {
      title: ui.titleInput.value.trim() || 'Untitled look', summary: S.look.summary || '',
      layers: S.look.layers.map(cleanLayer), duration: cleanDuration(S.look.duration), bpm: S.look.bpm || null,
    };
  }
  function snapshot() { return JSON.stringify(saveBody()); }
  function isDirty() { return S.ready && snapshot() !== S.saved; }

  const updateSaveState = st.updateSaveState = debounce(() => {
    if (!alive) return;
    const dirty = S.dirty = isDirty();
    ui.studio.classList.toggle('is-dirty', dirty);
    ui.saveState.textContent = S.saving ? 'Saving…'
      : S.copyOnSave ? (dirty ? 'Edited — Save makes your copy' : 'Gallery look')
      : !S.look.id ? 'Not saved yet' : dirty ? 'Unsaved changes' : 'Saved';
    ui.saveState.dataset.state = dirty || !S.look.id ? 'dirty' : 'clean';
  }, 120);

  function markDirty() {
    updateSaveState();
    if (S.baked) {
      preview.playBaked(false);
      toast('Back to the live preview: the baked frames show the look as it was baked, not your edits.',
        { timeout: 5000 });
    }
    if (S.ready) bakePanel.render();
  }

  /** The server sent a newer copy of this look (after a save, a bake, a review). */
  function adoptServer(look) {
    if (!look || (S.look.id && look.id !== S.look.id)) return;
    S.server = look;
    S.look.reviewed = !!look.reviewed;
    S.look.bake = look.bake || null;
    if (S.baked && !(look.bake && look.bake.frames)) preview.playBaked(false);
    bakePanel.render();
  }

  function pushLook() {
    if (!preview.runtime) return;
    compileSoon.cancel();
    preview.runtime.setLook(S.look.layers.map((l) => {
      const c = { ...cleanLayer(l), code: status.codeFor(l) };
      return silent(l.id) ? { ...c, level: 0, enabled: false } : c;
    }));
    preview.kick();
  }

  /** Something about the look changed: tell the sandbox, mark dirty, redraw panels. */
  function changed({ look = true, dirty = true, stack: redrawStack = true } = {}) {
    if (look) pushLook();
    if (dirty) markDirty();
    if (redrawStack) renderStack(); else timeline.render();
    refreshParams();
  }

  function renderStack() {
    const statuses = new Map(S.look.layers.map((l) => [l.id, status.of(l.id)]));
    stack.render({ layers: S.look.layers, selectedId: S.selectedId, status: statuses, muted: S.muted, solo: S.solo,
      groupNames });
    const l = selected();
    const i = l ? S.look.layers.indexOf(l) : -1;
    ui.upBtn.disabled = !l || i >= S.look.layers.length - 1;
    ui.downBtn.disabled = !l || i <= 0;
    ui.dupBtn.disabled = ui.delBtn.disabled = !l;
    timeline.render();
  }

  function refreshParams() {
    const l = selected();
    if (!l) return params.set(null, null, {});
    const { schema, note } = status.params(l.id);
    params.set(l.id, schema, l.params || {}, note);
  }

  function refresh() {
    if (!S.ready) return;
    renderStack();
    refreshParams();
    const l = selected();
    const problem = l ? status.problem(l.id) : null;
    editor.setProblem(problem);
    ui.codeIssue.hidden = !problem;
    if (problem) {
      ui.codeIssue.dataset.kind = problem.kind;
      ui.codeIssue.textContent = ISSUE_LABELS[problem.kind] || 'Problem';
    }
  }

  function select(id) {
    S.selectedId = id;
    const l = selected();
    editor.setValue(l ? l.code : '');
    editor.setDisabled(!l, l ? '' : 'Add a layer to write code.');
    ui.layerTitle.value = l ? l.title : '';
    ui.layerTitle.disabled = !l;
    showLayerName(l);
    ui.playsOn.textContent = l ? groupNames(l.groups) : '—';
    if (groupsTree) {
      groupsTree.setLayer(l);
      if (l) groupsTree.reveal(l.groups);
    }
    refresh();
  }
  function showLayerName(l) {
    ui.codeFor.textContent = l ? l.title : '';
    ui.groupsFor.textContent = l ? `for ${l.title}` : '';
  }

  const layerOps = createLayerOps({ S, ui, changed, select, selected, setTab, narrow: () => narrowMq.matches,
    groupsTree: () => groupsTree, groupNames, showLayerName });
  const { toggleGroup } = layerOps;
  const updateHighlight = () => {
    const id = S.hoverGroup || S.pinnedGroup;
    if (preview.viewer && S.index) preview.viewer.setHighlight(id ? S.index.masks.get(id) : null);
  };

  ui.titleInput.addEventListener('input', () => { S.look.title = ui.titleInput.value; markDirty(); });
  ui.titleInput.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), ui.titleInput.blur()));
  ui.titleInput.addEventListener('blur', () => {
    if (!ui.titleInput.value.trim()) { ui.titleInput.value = S.look.title = 'Untitled look'; markDirty(); }
  });
  ui.saveBtn.addEventListener('click', () => actions.save());
  const onDocClick = (e) => { if (!ui.menuWrap.contains(e.target)) ui.closeMenu(); };
  document.addEventListener('click', onDocClick);

  function setTab(id, { onlyNarrow = false } = {}) {
    if (onlyNarrow && !narrowMq.matches) return;
    if (!TABS.some((t) => t.id === id)) id = 'layers';
    ui.studio.dataset.tab = id;
    for (const b of ui.tabBtns) b.setAttribute('aria-pressed', String(b.dataset.tab === id));
    pref('studio.tab', id);
    if (id === 'look') actions.loadMyLooks();
  }

  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); actions.save(); return; }
    const t = e.target;
    const control = isTyping(t)
      || [HTMLButtonElement, HTMLSelectElement, HTMLInputElement].some((c) => t instanceof c);
    if (e.key === ' ' && !control && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      preview.setPlaying(!S.playing);
    }
  };
  document.addEventListener('keydown', onKey);

  return {
    isDirty,
    discard() { S.saved = snapshot(); },
    unmount() {
      alive = false;
      compileSoon.cancel();
      updateSaveState.cancel();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDocClick);
      narrowMq.removeEventListener('change', placePanels);
      timeline.destroy();
      bakePanel.destroy();
      preview.destroy();
    },
  };
}
