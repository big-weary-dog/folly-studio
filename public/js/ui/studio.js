// The Studio: groups tree · 3D view + transport · layer stack, module chain + params · code, timeline and look.
// This module holds the look and wires the panels: studio-layout.js builds them, chain.js tracks what the sandbox
// says about each layer and module and shows the selected layer's chain, studio-preview.js runs the 3D view and the
// clock, and studio-actions.js saves, shares and exports.
import { api } from '../api.js';
import { BakePanel } from './bake.js';
import { debounce, h, pref, reducedMotion, stylesheet, toast } from './dom.js';
import { CodeEditor, quickReference } from './editor.js';
import { createChain, createLayerStatus, ISSUE_LABELS } from './chain.js';
import { createLayerOps, GroupsTree, LayerStack } from './layers.js';
import {
  buildGroupIndex, cleanLayer, layerFromPattern, loadLibrary, loadPalettes, loadRig, makeLayer, normaliseLayers,
} from './model.js';
import { createActions } from './studio-actions.js';
import { buildLayout, TABS } from './studio-layout.js';
import { createPreview } from './studio-preview.js';
import { Timeline } from './timeline.js';
import { cleanBpm, cleanDuration } from './timeline-model.js';

await Promise.all([stylesheet('/css/studio.css'), stylesheet('/css/compose.css')]);

const copy = (v) => (v == null ? undefined : JSON.parse(JSON.stringify(v)));
const COMPILE_DELAY_MS = 300;

export function mount(root, ctx) {
  ctx.setTitle('Studio');
  const me = ctx.user;
  let alive = true, groupsTree = null, globalsPanel = null, globalsP = null;
  const S = {
    look: { id: null, title: 'Untitled look', summary: '', layers: [], duration: 30, bpm: null, shared: false,
      ideaId: null, owner: me?.id, ownerName: me?.username, reviewed: false, bake: null, globals: {} },
    server: null,              // the look as the server last sent it (bake, reviewed, …), null until saved
    baked: null,               // { frames, rgb, index } while the preview plays baked frames
    rig: null, index: null, library: [], copyOnSave: false, selectedId: null, saved: '', muted: new Set(),
    solo: new Set(), playing: !reducedMotion(), t: 0, speed: 1, hoverGroup: null, pinnedGroup: null, saving: false,
    ready: false, dirty: false, heavy: new Map(),  // layers too slow for a phone's 40 fps: id → ms a frame
  };
  const narrowMq = matchMedia('(max-width: 899px)');
  const layerById = (id) => S.look.layers.find((l) => l.id === id) || null;
  const selected = () => layerById(S.selectedId);
  const toggle = (set, id) => { if (!set.delete(id)) set.add(id); changed({ dirty: false }); };
  const silent = (id) => S.muted.has(id) || (S.solo.size > 0 && !S.solo.has(id));
  const groupNames = (ids) => (ids?.length ? ids.map((id) => S.index?.byId.get(id)?.name || id).join(', ')
    : S.index?.byId.get(S.index.root)?.name || 'Everything');

  const st = { S, ctx, isDirty, saveBody, adoptServer, markDirty, alive: () => alive,
    flush: () => compileSoon.flush() };
  const ui = st.ui = buildLayout({ store: pref, tab: pref('studio.tab') || 'layers', setTab, onDock,
    actions: { exportFseq: () => actions.exportFseq(), exportJson: () => actions.exportJson(),
      details: () => actions.details() } });
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
  // Edits mid-drag (live) only let the preview catch up.
  const edited = ({ live }) => { if (live) { pushLook(); markDirty(); } else changed(); };
  const timeline = new Timeline({
    toolsSlot: ui.dock.toolsSlot, layers: () => S.look.layers, look: () => S.look, selectedId: () => S.selectedId,
    time: () => S.t, onSelectLayer: (id) => select(id), signedOut: () => ctx.signedOut(),
    onSeek: (t) => { S.t = t; preview.kick(); },
    onEdit: (how) => {        // clips, the length or the tempo
      S.look.duration = cleanDuration(S.look.duration);
      S.t %= S.look.duration;
      edited(how);
    },
  });
  const preview = st.preview = createPreview({
    S, ui, timeline, alive: () => alive, signedOut: () => ctx.signedOut(),
    onCompiled: (layers) => { if (status.compiled(layers)) pushLook(); refresh(); },
    onFrameErrors: (errors) => { if (status.frameErrors(errors)) refresh(); },
    onBaked: (on) => bakePanel.setPlaying(on),
    onHeavy: (heavy) => { S.heavy = heavy; renderStack(); },
  });
  // Bake card, timeline and the look's globals: where they go depends on the screen.
  const placePanels = () => {
    const narrow = narrowMq.matches;
    (narrow ? ui.bakeSlotNarrow : ui.bakeSlotWide).append(bakePanel.el);
    (narrow ? ui.timeBody : ui.dock.timelineBody).append(timeline.el);
    if (globalsPanel) (narrow ? ui.globalsSlotNarrow : ui.dock.lookBody).append(globalsPanel.el);
    timeline.setMode(narrow);
  };
  placePanels();
  narrowMq.addEventListener('change', placePanels);

  const stack = new LayerStack(ui.layersBody, {
    onSelect: (id) => select(id),
    onChange: (id, patch, how = {}) => {
      const l = layerById(id);
      if (l) { Object.assign(l, patch); edited(how); }
    },
    onToggleMute: (id) => toggle(S.muted, id),
    onToggleSolo: (id) => toggle(S.solo, id),
  });
  const editor = new CodeEditor(ui.dock.codeBody, {
    onInput: (code) => { const m = chain.module(); if (!m) return; m.code = code; markDirty(); compileSoon(); },
    onSave: () => actions.save(),
  });
  const chain = createChain({ S, ui, editor, status, preview, selected, changed: (o) => changed(o),
    refresh: () => refresh() });
  ui.dock.codeBody.append(quickReference((text) => editor.insert(text)));
  const compileSoon = debounce(() => { pushLook(); refresh(); }, COMPILE_DELAY_MS);

  preview.showMsg('Loading the rig…');
  const library = loadLibrary().catch((err) => {
    toast(`Library unavailable: ${err.message}`, { kind: 'error' });
    return [];
  });
  Promise.all([loadRig(), library, loadLook()]).then(([rig, lib, look]) => {
    if (!alive) return;
    Object.assign(S, { rig, index: buildGroupIndex(rig), library: lib });
    setupLook(look);
    preview.start(rig, lib.filter((p) => (p.kind || 'source') === 'source'));
    pushLook();
    groupsTree = new GroupsTree(ui.groupsBody, S.index, {
      onToggle: (id, checked) => toggleGroup(id, checked),
      onHover: (id) => { S.hoverGroup = id; highlight(); },
      onPin: (id) => { S.pinnedGroup = id; highlight(); },
    });
    S.ready = true;
    if (S.wantGlobals) showGlobals();
    bakePanel.render();
    select(S.look.layers.at(-1)?.id ?? null);
    preview.kick();
  }).catch((err) => {
    if (!alive) return;
    if (err.status === 401) return ctx.signedOut();
    preview.showMsg(`Could not open the Studio: ${err.message}`, true);
    toast(err.message, { kind: 'error' });
  });

  async function loadLook() {
    const id = ctx.params.lookId;
    try {
      return id ? (await api.look(id)).look : null;
    } catch (err) {
      if (err.status === 401) throw err;
      toast(err.status === 404 ? 'That look was not found (or is not shared). Starting a new one.' : err.message,
        { kind: 'error' });
      ctx.replaceUrl('/studio');
      return null;
    }
  }

  function setupLook(look) {
    if (look) {
      Object.assign(S.look, {
        id: look.id, title: look.title || 'Untitled look', summary: look.summary || '', shared: !!look.shared,
        layers: normaliseLayers(look.layers, S.rig), ideaId: look.ideaId || null, owner: look.owner,
        ownerName: look.ownerName, duration: cleanDuration(look.duration), bpm: cleanBpm(look.bpm),
        globals: copy(look.globals) || {}, automation: copy(look.automation),
      });
      S.copyOnSave = !!(me && look.owner && look.owner !== me.id);
      S.server = look;
      ctx.setTitle(S.look.title);
    }
    if (!S.look.layers.length) {
      const first = S.library.find((p) => (p.kind || 'source') === 'source');
      S.look.layers.push(first ? layerFromPattern(first, S.rig)
        : makeLayer({ title: 'Rising band' }, S.rig));
    }
    ui.titleInput.value = S.look.title;
    S.saved = snapshot();     // untouched: even a brand-new look only nags once edited
    actions.showShared(S.look.shared && !S.copyOnSave);
    if (S.copyOnSave) {
      ui.notice.replaceChildren(h('strong', { text: 'From the gallery' }), ` — “${S.look.title}” by `
        + `${S.look.ownerName || 'someone else'}. Play with it freely; Save makes your own copy.`);
      ui.notice.hidden = false;
    }
    updateSaveState();
  }

  /** The look as saved: what save() sends and what isDirty() compares. */
  function saveBody() {
    const some = (o) => (o && Object.keys(o).length ? copy(o) : null);
    return {
      title: ui.titleInput.value.trim() || 'Untitled look', summary: S.look.summary || '',
      layers: S.look.layers.map(cleanLayer), duration: cleanDuration(S.look.duration), bpm: S.look.bpm || null,
      globals: some(S.look.globals), automation: some(S.look.automation),
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
    if (S.baked && !look.bake?.frames) preview.playBaked(false);
    bakePanel.render();
  }

  function pushLook() {
    if (!preview.runtime) return;
    compileSoon.cancel();
    preview.runtime.setLook(S.look.layers.map((l) => {
      const c = cleanLayer(l);
      c.modules = c.modules.map((m) => ({ ...m, code: status.codeFor(l.id, m) }));
      return silent(l.id) ? { ...c, level: 0, enabled: false } : c;
    }), { globals: S.look.globals, automation: S.look.automation, bpm: S.look.bpm || undefined });
    preview.kick();
  }

  /** Something about the look changed: tell the sandbox, mark dirty, redraw panels. */
  function changed({ look = true, dirty = true, stack: redrawStack = true } = {}) {
    if (look) pushLook();
    if (dirty) markDirty();
    if (redrawStack) renderStack(); else timeline.render();
    chain.refreshParams();
  }

  function renderStack() {
    const statuses = new Map(S.look.layers.map((l) => [l.id, status.of(l.id)]));
    stack.render({ layers: S.look.layers, selectedId: S.selectedId, status: statuses, muted: S.muted, solo: S.solo,
      heavy: S.heavy, groupNames });
    const l = selected(), i = S.look.layers.indexOf(l);
    ui.upBtn.disabled = !l || i >= S.look.layers.length - 1;
    ui.downBtn.disabled = !l || i <= 0;
    ui.dupBtn.disabled = ui.delBtn.disabled = !l;
    timeline.render();
  }

  function refresh() {
    if (!S.ready) return;
    renderStack();
    chain.render();
    chain.refreshParams();
    globalsPanel?.render();
    const l = selected(), problem = l ? status.problem(l.id, chain.module()) : null;
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
    ui.layerTitle.value = l ? l.title : '';
    ui.layerTitle.disabled = !l;
    showLayerName(l);
    ui.playsOn.textContent = l ? groupNames(l.groups) : '—';
    groupsTree?.setLayer(l);
    if (l) groupsTree?.reveal(l.groups);
    refresh();
  }
  function showLayerName(l) {
    chain.show();
    ui.groupsFor.textContent = l ? `for ${l.title}` : '';
  }

  // The Look panel (the globals) loads when the Look tab of the dock, or a phone's, first shows.
  function onDock(id) {
    if (id !== 'look') return;
    S.wantGlobals = true;
    if (S.ready) showGlobals();
  }
  function showGlobals() {
    globalsP ||= Promise.all([import('./look-globals.js'), loadPalettes().catch(() => [])])
      .then(([{ GlobalsPanel }, palettes]) => {
        if (!alive) return;
        globalsPanel = new GlobalsPanel({ look: () => S.look, palettes,
          onChange: ({ live }) => { if (live) { pushLook(); markDirty(); } else changed({ stack: false }); } });
        placePanels();
        globalsPanel.render();
      });
  }

  const { toggleGroup } = createLayerOps({ S, ui, preview, changed, select, selected, setTab, groupNames, showLayerName,
    narrow: () => narrowMq.matches, groupsTree: () => groupsTree });
  const highlight = () => {
    const id = S.hoverGroup || S.pinnedGroup;
    preview.viewer?.setHighlight(id ? S.index.masks.get(id) : null);
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
    if (!TABS.includes(id)) id = 'layers';
    ui.studio.dataset.tab = id;
    for (const b of ui.tabBtns) b.setAttribute('aria-pressed', String(b.dataset.tab === id));
    pref('studio.tab', id);
    if (id === 'look') { actions.loadMyLooks(); onDock('look'); }
  }

  // Ctrl/⌘+S saves; Space plays or pauses unless a control or a dialog has it.
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); actions.save(); return; }
    if (e.key !== ' ' || e.target.closest?.('button, input, select, textarea, [contenteditable], dialog')) return;
    e.preventDefault();
    preview.setPlaying(!S.playing);
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
