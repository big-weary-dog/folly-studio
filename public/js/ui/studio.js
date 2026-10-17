// The Studio: groups tree · 3D view + transport · layer stack + params · code editor.
import { api } from '../api.js';
import { Viewer } from '../viewer.js';
import { Runtime, HUNG_MESSAGE } from '../runtime.js';
import { h, clear, confirmDialog, debounce, isTyping, nextId, openDialog, reducedMotion, toast } from './dom.js';
import {
  loadCathedral, loadLibrary, buildGroupIndex, makeLayer, layerFromPattern, cleanLayer,
  normaliseLayers, BLANK_CODE,
} from './model.js';
import { GroupsTree } from './groups.js';
import { LayerStack } from './layers.js';
import { ParamsPanel } from './params.js';
import { CodeEditor } from './editor.js';
import { Transport } from './transport.js';
import { quickReference } from './reference.js';
import { exportFseqDialog, exportLookJson } from './export.js';
import { BakePanel, loadBakedFrames, mb } from './bake.js';

// Narrow screens stack the panels under the 3D view and switch them with these tabs.
const TABS = [
  { id: 'layers', label: 'Layers' },
  { id: 'code', label: 'Code' },
  { id: 'groups', label: 'Groups' },
  { id: 'look', label: 'Look' },
];
const NARROW = '(max-width: 899px)';
// Below this height the code editor starts folded, so the cathedral gets the room (once the
// person opens or closes it, their choice sticks).
const SHORT = '(max-height: 899px)';
const RUNTIME_ERROR_HOLD_MS = 1200;
// The sandbox reports a layer it had to stop as an error starting with this.
const HUNG_RE = /^Pattern hung\b/;
const COMPILE_DELAY_MS = 300;

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* private mode etc. */ }
  return null;
}

export function mount(root, ctx) {
  ctx.setTitle('Studio');
  const me = ctx.user;
  let alive = true;

  const S = {
    cathedral: null,
    index: null,
    library: [],
    look: { id: null, title: 'Untitled look', summary: '', layers: [], shared: false, ideaId: null, owner: me?.id, ownerName: me?.username, reviewed: false, bake: null },
    server: null,              // the look as the server last sent it (bake, reviewed, …), null until saved
    baked: null,               // { frames, rgb, index } while the preview plays baked frames
    copyOnSave: false,
    selectedId: null,
    saved: '',
    compiled: new Map(),       // id → { ok, error, params, code } (latest reply)
    good: new Map(),           // id → last code that compiled: keeps running while new code is broken
    bad: new Map(),            // id → { code, error } for the newest code that failed to compile
    schemas: new Map(),        // id → last good params schema
    runtimeErr: new Map(),     // id → { error, at }
    hung: new Map(),           // id → 'hung' | 'probation'
    muted: new Set(),
    solo: new Set(),
    playing: !reducedMotion(),
    t: 0,
    speed: 1,
    duration: 30,
    hoverGroup: null,
    pinnedGroup: null,
    saving: false,
    ready: false,
  };

  // ---- skeleton ---------------------------------------------------------------------------

  const studio = h('div', { class: 'studio', dataset: { tab: store('studio.tab') || 'layers' } });
  root.append(studio);

  // toolbar
  const titleInput = h('input', { class: 'look-title', type: 'text', maxlength: 120, 'aria-label': 'Look title', placeholder: 'Untitled look', spellcheck: false });
  const saveState = h('span', { class: 'save-state', 'aria-live': 'polite' });
  const shareId = nextId('share');
  const shareBox = h('input', { type: 'checkbox', id: shareId, class: 'switch' });
  const shareWrap = h('div', { class: 'share-toggle' }, shareBox, h('label', { for: shareId, text: 'Share to gallery' }));
  const saveBtn = h('button', { type: 'button', class: 'btn primary save-btn', text: 'Save', title: 'Save (Ctrl+S)' });
  const menuBtn = h('button', { type: 'button', class: 'btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', text: 'Export' });
  const menu = h('div', { class: 'menu', role: 'menu', hidden: true },
    h('button', { type: 'button', role: 'menuitem', class: 'wide-only', text: 'Export .fseq…', onClick: () => { closeMenu(); doExportFseq(); } }),
    h('button', { type: 'button', role: 'menuitem', text: 'Export look JSON', onClick: () => { closeMenu(); doExportJson(); } }),
    h('button', { type: 'button', role: 'menuitem', text: 'Look details…', onClick: () => { closeMenu(); editDetails(); } }));
  const menuWrap = h('div', { class: 'menu-wrap' }, menuBtn, menu);
  const bar = h('div', { class: 'studio-bar' },
    h('div', { class: 'bar-title' }, titleInput, saveState),
    h('div', { class: 'bar-actions' }, shareWrap, menuWrap, saveBtn));
  const notice = h('div', { class: 'studio-notice', role: 'note', hidden: true });

  // viewer
  const canvas = h('canvas', { class: 'viewer-canvas', tabindex: 0,
    'aria-label': '3D preview of the cathedral. Drag to orbit, scroll or pinch to zoom, right-drag or two fingers to pan, double-click to reset. With focus: arrow keys orbit, Alt+arrows pan, plus and minus zoom.' });
  const viewBar = h('div', { class: 'view-bar', role: 'group', 'aria-label': 'Camera views' });
  const viewSelect = h('select', { class: 'view-select', 'aria-label': 'Camera view' });
  const ghostBtn = h('button', { type: 'button', class: 'view-btn ghost-btn', 'aria-pressed': 'true', text: 'Ghost', title: 'Show unlit LEDs faintly' });
  const viewerMsg = h('div', { class: 'viewer-msg', role: 'status', hidden: true });
  const bakedLive = h('button', { type: 'button', class: 'btn small', text: 'Back to live', onClick: () => playBaked(false) });
  const bakedBadge = h('div', { class: 'baked-badge', role: 'status', hidden: true },
    h('span', { class: 'baked-dot', 'aria-hidden': 'true' }), h('span', { class: 'baked-text' }), bakedLive);
  const viewerWrap = h('div', { class: 'viewer' }, canvas, viewBar, h('div', { class: 'view-compact' }, viewSelect), viewerMsg, bakedBadge);
  const sandboxHost = h('div', { class: 'sandbox-host', 'aria-hidden': 'true' });
  const paneViewer = h('section', { class: 'pane pane-viewer', 'aria-label': 'Preview' }, viewerWrap);
  const transport = new Transport(paneViewer, {
    onPlay: () => setPlaying(!S.playing),
    onRestart: () => { S.t = 0; kick(); },
    onSeek: (t) => { S.t = t; kick(); },
    onSpeed: (s) => { S.speed = s; },
  });

  // tabs (narrow screens)
  const tabBtns = TABS.map((t) => h('button', { type: 'button', class: 'tab', dataset: { tab: t.id }, text: t.label,
    onClick: () => setTab(t.id) }));
  const tabs = h('nav', { class: 'studio-tabs', 'aria-label': 'Studio panels' }, tabBtns);

  // panes
  const paneHead = (title, ...extra) => h('div', { class: 'pane-head' }, h('h2', { class: 'pane-title', text: title }), ...extra);

  const groupsFor = h('span', { class: 'pane-sub' });
  const groupsBody = h('div', { class: 'pane-body tree-wrap' });
  const paneGroups = h('section', { class: 'pane pane-groups', dataset: { pane: 'groups' }, 'aria-label': 'Groups' },
    paneHead('Groups', groupsFor), groupsBody);

  const addBtn = h('button', { type: 'button', class: 'btn small primary', text: '+ Add', title: 'Add a layer from the library' });
  const dupBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Duplicate layer', title: 'Duplicate layer', text: '⧉' });
  const delBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete layer', title: 'Delete layer', text: '🗑' });
  const upBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move layer up', title: 'Move up (toward the top)', text: '↑' });
  const downBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move layer down', title: 'Move down (toward the bottom)', text: '↓' });
  const layersBody = h('div', { class: 'pane-body' });
  const paneLayers = h('section', { class: 'pane pane-layers', dataset: { pane: 'layers' }, 'aria-label': 'Layers' },
    paneHead('Layers', h('div', { class: 'pane-tools' }, upBtn, downBtn, dupBtn, delBtn, addBtn)), layersBody);

  const layerTitleId = nextId('lt');
  const layerTitle = h('input', { id: layerTitleId, type: 'text', class: 'layer-title-input', maxlength: 80, spellcheck: false });
  const paramsBody = h('div', { class: 'params-host' });
  const playsOn = h('span', { class: 'plays-on-text' });
  const playsOnBtn = h('button', { type: 'button', class: 'btn small ghost narrow-only', text: 'Change', onClick: () => setTab('groups') });
  const paneParams = h('section', { class: 'pane pane-params', dataset: { pane: 'params' }, 'aria-label': 'Layer settings' },
    paneHead('Settings'),
    h('div', { class: 'pane-body params-wrap' },
      h('div', { class: 'field layer-title-field' }, h('label', { for: layerTitleId, text: 'Layer name' }), layerTitle),
      h('p', { class: 'plays-on' }, h('span', { class: 'plays-on-label', text: 'Plays on ' }), playsOn, playsOnBtn),
      paramsBody));
  const side = h('div', { class: 'side', dataset: { pane: 'layers' } }, paneLayers, paneParams);

  // The bottom dock (wide screens): tabs on the left of its head, the fold toggle on the right.
  // Code is the only tab today; a Timeline tab and pane slot in beside it.
  const codeFor = h('span', { class: 'pane-sub' });
  const codeIssue = h('span', { class: 'dock-issue', hidden: true });
  const retryBtn = h('button', { type: 'button', class: 'btn small', text: 'Try again', hidden: true });
  const codeBody = h('div', { class: 'pane-body code-body' });
  const collapseId = nextId('dock');
  const collapseBtn = h('button', { type: 'button', class: 'btn small ghost collapse-btn', 'aria-expanded': 'true', 'aria-controls': collapseId,
    title: 'Fold the editor away to give the 3D view more room' });
  const dockTabs = h('div', { class: 'dock-tabs', role: 'group', 'aria-label': 'Bottom panel' },
    h('button', { type: 'button', class: 'dock-tab', 'aria-pressed': 'true', text: 'Code', onClick: () => setCodeCollapsed(false) }));
  codeBody.id = collapseId;
  const paneCode = h('section', { class: 'pane pane-code', dataset: { pane: 'code' }, 'aria-label': 'Code' },
    h('div', { class: 'pane-head dock-head' }, dockTabs, codeFor, codeIssue, retryBtn, collapseBtn), codeBody);

  // "Look" tab (narrow screens): what the toolbar and the header hold on a wide screen
  const shareId2 = nextId('share');
  const shareBox2 = h('input', { type: 'checkbox', id: shareId2, class: 'switch' });
  const myLooks = h('ul', { class: 'mini-list' });
  const bakeSlotNarrow = h('div', { class: 'bake-slot' });
  const paneLook = h('section', { class: 'pane pane-look', dataset: { pane: 'look' }, 'aria-label': 'Look' },
    h('div', { class: 'pane-body look-body' },
      bakeSlotNarrow,
      h('div', { class: 'share-toggle big' }, shareBox2, h('label', { for: shareId2, text: 'Share to gallery' })),
      h('div', { class: 'look-actions' },
        h('button', { type: 'button', class: 'btn', text: 'Look details', onClick: () => editDetails() }),
        h('button', { type: 'button', class: 'btn', text: 'Export look JSON', onClick: () => doExportJson() })),
      h('h3', { class: 'look-h', text: 'My looks' }),
      myLooks,
      h('p', { class: 'look-links' },
        h('a', { href: '/ideas', text: 'Ideas' }), h('a', { href: '/looks', text: 'All my looks' }), h('a', { href: '/gallery', text: 'Gallery' }))));

  const splitter = h('div', { class: 'splitter', role: 'separator', 'aria-orientation': 'horizontal', tabindex: 0,
    'aria-label': 'Resize code editor', 'aria-valuemin': 15, 'aria-valuemax': 75 });

  studio.append(bar, notice, paneGroups, paneViewer, splitter, tabs, side, paneCode, paneLook, sandboxHost);
  setTab(studio.dataset.tab);
  const savedSplit = +store('studio.split');
  if (savedSplit >= 15 && savedSplit <= 75) studio.style.setProperty('--code-h', `${savedSplit}%`);
  {
    const pref = store('studio.codeCollapsed');
    setCodeCollapsed(pref === null ? matchMedia(SHORT).matches : pref === '1', { remember: false });
  }
  collapseBtn.addEventListener('click', () => setCodeCollapsed(!studio.classList.contains('code-collapsed')));
  function setCodeCollapsed(on, { remember = true } = {}) {
    studio.classList.toggle('code-collapsed', on);
    collapseBtn.setAttribute('aria-expanded', String(!on));
    collapseBtn.textContent = on ? 'Show code' : 'Hide';
    if (remember) store('studio.codeCollapsed', on ? '1' : '0');
  }

  // Bake card: under the groups tree on a wide screen, in the Look tab on a phone.
  const bakeSlotWide = h('div', { class: 'bake-slot' });
  paneGroups.append(bakeSlotWide);
  const bakePanel = new BakePanel(bakeSlotWide, {
    user: me,
    host: {
      look: () => (S.look.id && S.server ? { ...S.server, id: S.look.id } : null),
      dirty: () => isDirty(),
      save: async () => { await save(); return !!S.look.id && !isDirty(); },
      setLook: (look) => { adoptServer(look); bakePanel.render(); },
      playBaked: (on) => playBaked(on),
      signedOut: () => ctx.signedOut(),
    },
  });
  const narrowMq = matchMedia(NARROW);
  const placeBake = () => (narrowMq.matches ? bakeSlotNarrow : bakeSlotWide).append(bakePanel.el);
  placeBake();
  narrowMq.addEventListener('change', placeBake);

  // components
  const stack = new LayerStack(layersBody, {
    onSelect: (id) => select(id),
    onChange: (id, patch) => { const l = layerById(id); if (!l) return; Object.assign(l, patch); changed(); },
    onToggleMute: (id) => { toggleSet(S.muted, id); changed({ look: true, dirty: false }); },
    onToggleSolo: (id) => { toggleSet(S.solo, id); changed({ look: true, dirty: false }); },
  });
  const params = new ParamsPanel(paramsBody, {
    onChange: (key, value) => { const l = selected(); if (!l) return; l.params = { ...l.params, [key]: value }; changed({ stack: false }); },
    onReset: (key) => { const l = selected(); if (!l) return; const p = { ...l.params }; delete p[key]; l.params = p; changed({ stack: false }); },
    onResetAll: () => { const l = selected(); if (!l) return; l.params = {}; changed({ stack: false }); },
  });
  const editor = new CodeEditor(codeBody, {
    onInput: (code) => {
      const l = selected();
      if (!l) return;
      l.code = code;
      markDirty();
      compileSoon();
    },
    onSave: () => save(),
  });
  codeBody.append(quickReference((text) => editor.insert(text)));
  const compileSoon = debounce(() => { pushLook(); refresh(); }, COMPILE_DELAY_MS);

  let viewer = null;
  let runtime = null;
  let groupsTree = null;
  let raf = 0;

  // ---- loading ----------------------------------------------------------------------------

  showViewerMsg('Loading the cathedral…');
  Promise.all([loadCathedral(), loadLibrary().catch((err) => { toast(`Library unavailable: ${err.message}`, { kind: 'error' }); return []; }), loadLook()])
    .then(([cathedral, library, look]) => {
      if (!alive) return;
      S.cathedral = cathedral;
      S.index = buildGroupIndex(cathedral);
      S.library = library;
      setupLook(look);
      setupViewer();
      setupRuntime();
      groupsTree = new GroupsTree(groupsBody, cathedral, S.index, {
        onToggle: (id, checked) => toggleGroup(id, checked),
        onHover: (id) => { S.hoverGroup = id; updateHighlight(); },
        onPin: (id) => { S.pinnedGroup = id; updateHighlight(); },
      });
      S.ready = true;
      bakePanel.render();
      select(S.look.layers.length ? S.look.layers[S.look.layers.length - 1].id : null);
      watchVisibility();
      kick();
    })
    .catch((err) => {
      if (!alive) return;
      if (err.status === 401) { ctx.signedOut(); return; }
      showViewerMsg(`Could not open the Studio: ${err.message}`, true);
      toast(err.message, { kind: 'error' });
    });

  async function loadLook() {
    const id = ctx.params.lookId;
    if (!id) return null;
    try {
      const { look } = await api.look(id);
      return look;
    } catch (err) {
      if (err.status === 401) throw err;
      toast(err.status === 404 ? 'That look was not found (or is not shared). Starting a new one.' : err.message, { kind: 'error' });
      ctx.replaceUrl('/studio');
      return null;
    }
  }

  function setupLook(look) {
    if (look) {
      S.look = {
        id: look.id, title: look.title || 'Untitled look', summary: look.summary || '',
        layers: normaliseLayers(look.layers, S.cathedral), shared: !!look.shared, ideaId: look.ideaId || null,
        owner: look.owner, ownerName: look.ownerName,
      };
      S.copyOnSave = !!(me && look.owner && look.owner !== me.id);
      S.server = look;
      if (look.duration > 0) S.duration = look.duration;
      ctx.setTitle(S.look.title);
    } else {
      const first = S.library[0];
      S.look.layers = [first ? layerFromPattern(first, S.cathedral) : makeLayer({ title: 'Rising band', code: BLANK_CODE }, S.cathedral)];
      if (first) S.look.title = 'Untitled look';
    }
    if (!S.look.layers.length) S.look.layers.push(makeLayer({ title: 'Rising band' }, S.cathedral));
    titleInput.value = S.look.title;
    S.saved = snapshot();     // untouched — even a brand-new look only nags once edited
    shareBox.checked = shareBox2.checked = S.look.shared && !S.copyOnSave;
    if (S.copyOnSave) {
      clear(notice).append(
        h('strong', { text: 'From the gallery' }),
        ` — “${S.look.title}” by ${S.look.ownerName || 'someone else'}. Play with it freely; Save makes your own copy.`);
      notice.hidden = false;
    }
    updateSaveState();
  }

  function setupViewer() {
    viewer = new Viewer(canvas, { views: S.cathedral.views || {}, defaultView: 'fit', onError: (msg) => showViewerMsg(msg, true) });
    viewer.setCathedral(S.cathedral);
    const ghostPref = store('studio.ghost');
    if (ghostPref === '0') { viewer.setOption('ghost', 0); ghostBtn.setAttribute('aria-pressed', 'false'); }
    const names = ['fit', ...Object.keys(S.cathedral.views || {})];
    const label = (n) => n.charAt(0).toUpperCase() + n.slice(1);
    for (const name of names) {
      viewBar.append(h('button', { type: 'button', class: 'view-btn', dataset: { view: name }, 'aria-pressed': 'false',
        title: name === 'fit' ? 'Frame the whole cathedral (double-click the view does this too)' : `The “${name}” view from views.json`,
        text: label(name), onClick: () => viewer.setView(name) }));
      viewSelect.append(h('option', { value: name, text: label(name) }));
    }
    viewSelect.append(h('option', { value: '', text: 'Free camera', disabled: true }));
    viewSelect.addEventListener('change', () => { if (viewSelect.value) viewer.setView(viewSelect.value); });
    viewBar.append(ghostBtn);
    viewerWrap.querySelector('.view-compact').append(ghostBtn.cloneNode(true));
    const ghost2 = viewerWrap.querySelector('.view-compact .ghost-btn');
    ghost2.addEventListener('click', () => ghostBtn.click());
    ghostBtn.addEventListener('click', () => {
      const on = ghostBtn.getAttribute('aria-pressed') !== 'true';
      ghostBtn.setAttribute('aria-pressed', String(on));
      ghost2.setAttribute('aria-pressed', String(on));
      viewer.setOption('ghost', on ? 0.14 : 0);
      store('studio.ghost', on ? '1' : '0');
    });
    if (ghostPref === '0') ghost2.setAttribute('aria-pressed', 'false');
  }

  function setupRuntime() {
    runtime = new Runtime({
      container: sandboxHost,
      onFrame: (rgb) => { if (viewer) viewer.setColors(rgb); },
      onCompiled: (layers) => { onCompiled(layers); kick(); },
      onFrameErrors: (errors) => onFrameErrors(errors),
      onHung: (ids, { probation }) => {
        for (const id of ids) S.hung.set(id, probation ? 'probation' : 'hung');
        const names = ids.map((id) => `“${layerById(id)?.title || id}”`).join(', ');
        toast(probation
          ? `A pattern hung (a frame took over 2 s). Layers ${names} are paused and will come back one at a time.`
          : `${names} hung (a frame took over 2 s) and is paused. Edit its code to try again.`, { kind: 'error', timeout: 9000 });
        refresh();
        kick();
      },
      onStatus: (state, detail) => {
        if (state === 'loading' && !S.everReady) showViewerMsg('Starting the pattern engine…');
        else if (state === 'ready') { S.everReady = true; hideViewerMsg(); kick(); }
        else if (state === 'dead') showViewerMsg(detail || 'The pattern engine stopped.', true);
        else if (state === 'warning' && detail) toast(detail, { kind: 'warn' });
      },
    });
    runtime.start(S.cathedral);
    pushLook();
  }

  // ---- state helpers ---------------------------------------------------------------------

  function layerById(id) { return S.look.layers.find((l) => l.id === id) || null; }
  function selected() { return layerById(S.selectedId); }
  function toggleSet(set, id) { if (set.has(id)) set.delete(id); else set.add(id); }

  function snapshot() {
    return JSON.stringify({ title: titleInput.value.trim() || S.look.title, summary: S.look.summary || '', layers: S.look.layers.map(cleanLayer) });
  }
  function isDirty() { return S.ready && snapshot() !== S.saved; }

  const updateSaveState = debounce(() => {
    if (!alive) return;
    const dirty = isDirty();
    studio.classList.toggle('is-dirty', dirty);
    if (S.saving) saveState.textContent = 'Saving…';
    else if (S.copyOnSave) saveState.textContent = dirty ? 'Edited — Save makes your copy' : 'Gallery look';
    else if (!S.look.id) saveState.textContent = 'Not saved yet';
    else saveState.textContent = dirty ? 'Unsaved changes' : 'Saved';
    saveState.dataset.state = dirty || !S.look.id ? 'dirty' : 'clean';
  }, 120);
  function markDirty() {
    updateSaveState();
    if (S.baked) {
      playBaked(false);
      toast('Back to the live preview: the baked frames show the look as it was baked, not your edits.', { timeout: 5000 });
    }
    if (S.ready) bakePanel.render();
  }

  /** The server sent a newer copy of this look (after a save, a bake, a review). */
  function adoptServer(look) {
    if (!look || (S.look.id && look.id !== S.look.id)) return;
    S.server = look;
    S.look.reviewed = !!look.reviewed;
    S.look.bake = look.bake || null;
    if (S.baked && !(look.bake && look.bake.frames)) playBaked(false);
    bakePanel.render();
  }

  function sandboxLayers() {
    const soloing = S.solo.size > 0;
    return S.look.layers.map((l) => {
      const c = cleanLayer(l);
      const bad = S.bad.get(l.id);
      if (bad && bad.code === l.code && S.good.has(l.id)) c.code = S.good.get(l.id);
      const silent = S.muted.has(l.id) || (soloing && !S.solo.has(l.id));
      if (silent) { c.level = 0; c.enabled = false; }
      return c;
    });
  }

  function pushLook() {
    if (!runtime) return;
    compileSoon.cancel();
    runtime.setLook(sandboxLayers());
    kick();
  }

  /** Something about the look changed: tell the sandbox, mark dirty, redraw panels. */
  function changed({ look = true, dirty = true, stack: redrawStack = true } = {}) {
    if (look) pushLook();
    if (dirty) markDirty();
    if (redrawStack) renderStack();
    refreshParams();
  }

  // ---- compile / frame results -------------------------------------------------------------

  function onCompiled(layers) {
    let fallback = false;
    for (const r of layers) {
      if (r.hung) {
        if (!S.hung.has(r.id)) S.hung.set(r.id, 'hung');
        continue;
      }
      S.hung.delete(r.id);
      const l = layerById(r.id);
      S.compiled.set(r.id, { ok: !!r.ok, error: r.error || '', params: r.params || null, code: r.code });
      if (r.ok) {
        S.good.set(r.id, r.code);
        if (r.params) S.schemas.set(r.id, r.params);
        if (l && r.code === l.code) S.bad.delete(r.id);
        S.runtimeErr.delete(r.id);
      } else {
        S.bad.set(r.id, { code: r.code, error: r.error || 'Compile error' });
        // keep the last good version on the model while this one is broken
        if (S.good.has(r.id) && S.good.get(r.id) !== r.code && l && l.code === r.code) fallback = true;
      }
    }
    if (fallback) pushLook();
    refresh();
  }

  let lastErrKey = '';
  function onFrameErrors(errors) {
    if (!errors.length && !S.runtimeErr.size) return;          // the usual case: nothing to do
    const now = performance.now();
    for (const e of errors) {
      const prev = S.runtimeErr.get(e.id);
      const msg = String(e.error || 'error');
      if (prev) { prev.at = now; prev.error = msg; } else S.runtimeErr.set(e.id, { error: msg, at: now });
    }
    for (const [id, e] of S.runtimeErr) if (now - e.at > RUNTIME_ERROR_HOLD_MS) S.runtimeErr.delete(id);
    let key = '';
    for (const [id, e] of S.runtimeErr) key += id + e.error + '|';
    if (key !== lastErrKey) { lastErrKey = key; refresh(); }
  }

  function statusOf(id) {
    const l = layerById(id);
    const hung = S.hung.get(id);
    if (hung === 'hung') return { kind: 'hung', message: HUNG_MESSAGE };
    if (hung === 'probation') return { kind: 'probation', message: 'Paused while the Studio works out which layer hung. It comes back by itself.' };
    const bad = S.bad.get(id);
    if (bad && l && bad.code === l.code) return { kind: 'compile', message: bad.error };
    const c = S.compiled.get(id);
    if (!c || !l || c.code !== l.code) return { kind: 'pending', message: bad ? bad.error : '' };
    const rt = S.runtimeErr.get(id);
    if (rt) return { kind: HUNG_RE.test(rt.error) ? 'hung' : 'runtime', message: rt.error, sandbox: true };
    const silent = S.muted.has(id) || (S.solo.size > 0 && !S.solo.has(id));
    return { kind: silent ? 'muted' : 'ok' };
  }

  // ---- rendering the panels ------------------------------------------------------------------

  function groupNames(ids) {
    if (!ids || !ids.length) return 'Whole cathedral';
    return ids.map((id) => S.index?.byId.get(id)?.name || id).join(', ');
  }

  function renderStack() {
    const status = new Map(S.look.layers.map((l) => [l.id, statusOf(l.id)]));
    stack.render({ layers: S.look.layers, selectedId: S.selectedId, status, muted: S.muted, solo: S.solo, groupNames });
    const l = selected();
    const i = l ? S.look.layers.indexOf(l) : -1;
    upBtn.disabled = !l || i >= S.look.layers.length - 1;
    downBtn.disabled = !l || i <= 0;
    dupBtn.disabled = !l;
    delBtn.disabled = !l;
  }

  function refreshParams() {
    const l = selected();
    if (!l) { params.set(null, null, {}); return; }
    const c = S.compiled.get(l.id);
    const schema = (c && c.ok && c.params) || S.schemas.get(l.id) || null;
    let note;
    if (S.hung.has(l.id)) note = { message: 'This layer is paused because its pattern hung.' };
    else if (S.bad.has(l.id) && !S.schemas.get(l.id)) note = { message: 'Fix the code’s error to get its controls.' };
    else if (!c && !schema) note = { message: 'Compiling…' };
    params.set(l.id, schema, l.params || {}, note);
  }

  function refreshProblem() {
    const l = selected();
    if (!l) { editor.setProblem(null); retryBtn.hidden = true; return; }
    const st = statusOf(l.id);
    let problem = null;
    const compileKind = HUNG_RE.test(st.message || '') ? 'hung' : 'compile';
    if (st.kind === 'hung' || st.kind === 'probation') problem = { kind: st.kind, message: st.message };
    else if (st.kind === 'compile') problem = { kind: compileKind, message: st.message, running: S.good.has(l.id) };
    else if (st.kind === 'pending' && st.message) problem = { kind: compileKind, message: st.message, running: S.good.has(l.id) };
    else if (st.kind === 'runtime') problem = { kind: 'runtime', message: st.message };
    editor.setProblem(problem);
    // Try again is for the app-side watchdog's parking; a layer the sandbox paused retries on edit.
    retryBtn.hidden = st.kind !== 'hung' || st.sandbox === true;
    codeIssue.hidden = !problem;
    if (problem) {
      codeIssue.dataset.kind = problem.kind;
      codeIssue.textContent = { compile: 'Compile error', runtime: 'Runtime error', hung: 'Hung', probation: 'Paused' }[problem.kind] || 'Problem';
    }
  }

  function refresh() {
    if (!S.ready) return;
    renderStack();
    refreshParams();
    refreshProblem();
  }

  function select(id) {
    S.selectedId = id;
    const l = selected();
    editor.setValue(l ? l.code : '');
    editor.setDisabled(!l, l ? '' : 'Add a layer to write code.');
    layerTitle.value = l ? l.title : '';
    layerTitle.disabled = !l;
    codeFor.textContent = l ? l.title : '';
    groupsFor.textContent = l ? `for ${l.title}` : '';
    playsOn.textContent = l ? groupNames(l.groups) : '—';
    if (groupsTree) {
      groupsTree.setLayer(l);
      if (l) groupsTree.reveal(l.groups);
    }
    refresh();
  }

  // ---- layer operations -----------------------------------------------------------------------

  function insertLayer(layer, at) {
    const i = at ?? (selected() ? S.look.layers.indexOf(selected()) + 1 : S.look.layers.length);
    S.look.layers.splice(i, 0, layer);
    changed();
    select(layer.id);
  }

  addBtn.addEventListener('click', () => chooseFromLibrary());
  dupBtn.addEventListener('click', () => {
    const l = selected();
    if (!l) return;
    const copy = makeLayer({ ...cleanLayer(l), title: `${l.title} copy` }, S.cathedral);
    insertLayer(copy, S.look.layers.indexOf(l) + 1);
  });
  delBtn.addEventListener('click', () => {
    const l = selected();
    if (!l) return;
    const i = S.look.layers.indexOf(l);
    S.look.layers.splice(i, 1);
    S.muted.delete(l.id);
    S.solo.delete(l.id);
    changed();
    const next = S.look.layers[Math.min(i, S.look.layers.length - 1)];
    select(next ? next.id : null);
    toast(`Deleted “${l.title}”.`, { action: { label: 'Undo', onClick: () => {
      S.look.layers.splice(Math.min(i, S.look.layers.length), 0, l);
      changed();
      select(l.id);
    } } });
  });
  upBtn.addEventListener('click', () => move(+1));
  downBtn.addEventListener('click', () => move(-1));
  function move(dir) {
    const l = selected();
    if (!l) return;
    const i = S.look.layers.indexOf(l), j = i + dir;
    if (j < 0 || j >= S.look.layers.length) return;
    S.look.layers.splice(i, 1);
    S.look.layers.splice(j, 0, l);
    changed();
  }

  layerTitle.addEventListener('input', () => {
    const l = selected();
    if (!l) return;
    l.title = layerTitle.value;
    codeFor.textContent = l.title;
    groupsFor.textContent = `for ${l.title}`;
    changed({ look: false });
  });
  layerTitle.addEventListener('blur', () => {
    const l = selected();
    if (l && !l.title.trim()) { l.title = 'Layer'; layerTitle.value = l.title; changed({ look: false }); }
  });

  retryBtn.addEventListener('click', () => {
    const l = selected();
    if (!l || !runtime) return;
    runtime.retry(l.id);
    S.hung.delete(l.id);
    refresh();
  });

  function toggleGroup(id, checked) {
    const l = selected();
    if (!l) return;
    const set = new Set(l.groups);
    if (checked) set.add(id); else set.delete(id);
    if (!set.size) {
      toast('A layer needs at least one group. Tick another group first.', { kind: 'warn' });
      groupsTree.setLayer(l);
      return;
    }
    l.groups = [...set];
    groupsTree.setLayer(l);
    playsOn.textContent = groupNames(l.groups);
    changed();
  }

  function updateHighlight() {
    if (!viewer || !S.index) return;
    const id = S.hoverGroup || S.pinnedGroup;
    viewer.setHighlight(id ? S.index.masks.get(id) : null);
  }

  function chooseFromLibrary() {
    openDialog({
      title: 'Add a layer',
      className: 'library-dialog',
      build: (close) => {
        const list = h('ul', { class: 'library-list' });
        const pick = (layer, blank) => {
          close();
          insertLayer(layer);
          setTab('code', { onlyNarrow: true });
          if (blank && !narrowMq.matches) setCodeCollapsed(false);   // a blank layer is for writing code
        };
        list.append(h('li', {}, h('button', { type: 'button', class: 'library-item blank', onClick: () => pick(makeLayer({ title: 'New layer' }, S.cathedral), true) },
          h('span', { class: 'library-title', text: 'Blank pattern' }),
          h('span', { class: 'library-summary', text: 'A minimal starting point: one colour, one moving band.' }))));
        for (const p of S.library) {
          list.append(h('li', {}, h('button', { type: 'button', class: 'library-item', onClick: () => pick(layerFromPattern(p, S.cathedral)) },
            h('span', { class: 'library-title', text: p.title || p.name }),
            p.summary ? h('span', { class: 'library-summary', text: p.summary }) : null)));
        }
        if (!S.library.length) list.append(h('li', { class: 'pane-hint', text: 'The pattern library could not be loaded.' }));
        return list;
      },
    });
  }

  // ---- toolbar actions --------------------------------------------------------------------------

  titleInput.addEventListener('input', () => { S.look.title = titleInput.value; markDirty(); });
  titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); } });
  titleInput.addEventListener('blur', () => { if (!titleInput.value.trim()) { titleInput.value = S.look.title = 'Untitled look'; markDirty(); } });
  saveBtn.addEventListener('click', () => save());
  shareBox.addEventListener('change', () => setShared(shareBox.checked));

  async function save() {
    if (!S.ready || S.saving) return;
    compileSoon.flush();
    const title = titleInput.value.trim() || 'Untitled look';
    const body = { title, summary: S.look.summary || '', layers: S.look.layers.map(cleanLayer) };
    const snap = JSON.stringify(body);
    S.saving = true;
    saveBtn.disabled = true;
    saveBtn.classList.add('busy');
    updateSaveState();
    try {
      let look;
      if (!S.look.id || S.copyOnSave) {
        const payload = { ...body };
        if (S.look.ideaId && !S.copyOnSave) payload.ideaId = S.look.ideaId;
        ({ look } = await api.createLook(payload));
        const wasCopy = S.copyOnSave;
        S.copyOnSave = false;
        notice.hidden = true;
        S.look.owner = look.owner;
        S.look.ownerName = look.ownerName;
        S.look.shared = !!look.shared;
        showShared(S.look.shared);
        ctx.replaceUrl(`/studio/${encodeURIComponent(look.id)}`);
        toast(wasCopy ? 'Saved as your own copy.' : 'Saved.', { kind: 'ok' });
      } else {
        ({ look } = await api.updateLook(S.look.id, body));
        toast(S.server?.bake && !look.bake ? 'Saved. The old bake was cleared: bake again to check the new code.' : 'Saved.',
          { kind: 'ok', timeout: S.server?.bake && !look.bake ? 5000 : 1800 });
      }
      S.look.id = look.id;
      S.look.title = title;
      S.saved = snap;
      adoptServer(look);
      ctx.setTitle(title);
    } catch (err) {
      if (err.status === 401) { ctx.signedOut(); return; }
      toast(`Could not save: ${err.message}`, { kind: 'error', timeout: 8000 });
    } finally {
      S.saving = false;
      saveBtn.disabled = false;
      saveBtn.classList.remove('busy');
      updateSaveState();
    }
  }

  shareBox2.addEventListener('change', () => setShared(shareBox2.checked));
  function showShared(v) { shareBox.checked = shareBox2.checked = !!v; }
  async function setShared(on) {
    if (S.copyOnSave) {
      showShared(false);
      toast('This look belongs to someone else. Save your own copy first, then share it.', { kind: 'warn' });
      return;
    }
    shareBox.disabled = shareBox2.disabled = true;
    try {
      if (!S.look.id || isDirty()) await save();
      if (!S.look.id) { showShared(!on); return; }
      const { look } = await api.updateLook(S.look.id, { shared: on });
      S.look.shared = !!look.shared;
      adoptServer(look);
      showShared(S.look.shared);
      toast(S.look.shared ? 'Shared to the gallery.' : 'Removed from the gallery.', { kind: 'ok' });
    } catch (err) {
      if (err.status === 401) { ctx.signedOut(); return; }
      showShared(S.look.shared);
      toast(err.message, { kind: 'error' });
    } finally {
      shareBox.disabled = shareBox2.disabled = false;
    }
  }

  async function doExportFseq() {
    if (!runtime || !runtime.ready) { toast('The pattern engine is still starting.', { kind: 'warn' }); return; }
    compileSoon.flush();
    const paused = S.look.layers.filter((l) => statusOf(l.id).kind === 'hung');
    if (paused.length) {
      const names = paused.map((l) => `“${l.title}”`).join(', ');
      const ok = await confirmDialog(`${names} ${paused.length > 1 ? 'are' : 'is'} paused because ${paused.length > 1 ? 'they' : 'it'} hung, so the export would leave ${paused.length > 1 ? 'them' : 'it'} out. Export the rest anyway?`,
        { title: 'A layer is paused', ok: 'Export anyway' });
      if (!ok) return;
    }
    await exportFseqDialog({ runtime, cathedral: S.cathedral, title: titleInput.value.trim() || 'folly-look', duration: S.duration });
    // An export can find a layer that hangs: show where things stand now, even when paused.
    if (runtime && alive) { runtime.refresh(); kick(); }
  }

  function doExportJson() {
    compileSoon.flush();
    exportLookJson({ title: titleInput.value.trim() || 'Untitled look', summary: S.look.summary || '', layers: S.look.layers.map(cleanLayer) });
  }

  function editDetails() {
    openDialog({
      title: 'Look details',
      build: (close) => {
        const tId = nextId('d'), sId = nextId('d');
        const t = h('input', { id: tId, type: 'text', maxlength: 120, value: titleInput.value });
        const s = h('textarea', { id: sId, rows: 4, maxlength: 600, value: S.look.summary || '' });
        s.value = S.look.summary || '';
        return h('form', { class: 'details-form', onSubmit: (e) => {
          e.preventDefault();
          titleInput.value = S.look.title = t.value.trim() || 'Untitled look';
          S.look.summary = s.value.trim();
          markDirty();
          close(true);
        } },
        h('div', { class: 'field' }, h('label', { for: tId, text: 'Title' }), t),
        h('div', { class: 'field' }, h('label', { for: sId, text: 'Summary' }), s),
        S.look.ideaId ? h('p', { class: 'field-hint', text: 'Generated from one of your ideas.' }) : null,
        h('div', { class: 'dialog-actions' },
          h('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onClick: () => close(false) }),
          h('button', { type: 'submit', class: 'btn primary', text: 'Done' })));
      },
    });
  }

  // menu
  function closeMenu() { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('button').focus();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); menuBtn.focus(); }
  });
  const onDocClick = (e) => { if (!menuWrap.contains(e.target)) closeMenu(); };
  document.addEventListener('click', onDocClick);

  // ---- tabs, splitter, keys ---------------------------------------------------------------------

  function setTab(id, { onlyNarrow = false } = {}) {
    if (onlyNarrow && !matchMedia(NARROW).matches) return;
    if (!TABS.some((t) => t.id === id)) id = 'layers';
    studio.dataset.tab = id;
    for (const b of tabBtns) b.setAttribute('aria-pressed', String(b.dataset.tab === id));
    store('studio.tab', id);
    if (id === 'look') loadMyLooks();
  }

  let myLooksAt = 0;
  async function loadMyLooks() {
    if (Date.now() - myLooksAt < 15000) return;
    myLooksAt = Date.now();
    try {
      const { looks } = await api.looks('mine');
      clear(myLooks);
      const list = (looks || []).slice().sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0)).slice(0, 8);
      if (!list.length) myLooks.append(h('li', { class: 'pane-hint', text: 'Nothing saved yet.' }));
      for (const lk of list) {
        const here = lk.id === S.look.id;
        myLooks.append(h('li', {}, h('a', { href: `/studio/${encodeURIComponent(lk.id)}`, 'aria-current': here ? 'page' : null, text: lk.title || 'Untitled look' })));
      }
    } catch (err) {
      myLooksAt = 0;
      if (err.status === 401) ctx.signedOut();
    }
  }

  {
    let drag = null;
    splitter.addEventListener('pointerdown', (e) => {
      drag = { y: e.clientY, h: paneCode.getBoundingClientRect().height, total: studio.getBoundingClientRect().height };
      splitter.setPointerCapture(e.pointerId);
      studio.classList.add('resizing');
    });
    splitter.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const pct = Math.min(75, Math.max(15, ((drag.h + drag.y - e.clientY) / drag.total) * 100));
      setSplit(pct);
    });
    const end = () => { if (drag) { drag = null; studio.classList.remove('resizing'); } };
    splitter.addEventListener('pointerup', end);
    splitter.addEventListener('pointercancel', end);
    splitter.addEventListener('keydown', (e) => {
      const cur = parseFloat(studio.style.getPropertyValue('--code-h')) || 36;
      if (e.key === 'ArrowUp') { e.preventDefault(); setSplit(Math.min(75, cur + 4)); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSplit(Math.max(15, cur - 4)); }
    });
    function setSplit(pct) {
      studio.style.setProperty('--code-h', `${pct.toFixed(1)}%`);
      splitter.setAttribute('aria-valuenow', String(Math.round(pct)));
      store('studio.split', pct.toFixed(1));
    }
  }

  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (e.key === ' ' && !isTyping(e.target) && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLSelectElement)
        && !(e.target instanceof HTMLInputElement) && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      setPlaying(!S.playing);
    }
  };
  document.addEventListener('keydown', onKey);

  function setPlaying(on) { S.playing = on; kick(); }

  // ---- baked playback: the server's frames, no pattern code -----------------------------------

  let bakedLoad = 0;
  async function playBaked(on) {
    const token = ++bakedLoad;
    if (!on) {
      if (!S.baked) return;
      S.baked = null;
      bakedBadge.hidden = true;
      studio.classList.remove('is-baked');
      bakePanel.setPlaying(false);
      S.t = 0;
      if (runtime) runtime.pump(S.t, true);       // a fresh frame from the live look
      kick();
      return;
    }
    if (!S.look.id || !S.cathedral) return;
    showViewerMsg('Loading the baked frames…');
    try {
      const frames = await loadBakedFrames(S.look.id, S.cathedral);
      if (!alive || token !== bakedLoad) return;
      S.baked = { frames, rgb: new Float32Array(S.cathedral.count * 3), index: -1 };
      S.t = 0;
      S.playing = true;
      hideViewerMsg();
      clear(bakedBadge.querySelector('.baked-text')).append(
        `Baked frames · ${frames.seconds.toFixed(frames.seconds % 1 ? 1 : 0)} s`,
        h('span', { class: 'baked-extra', text: ` · ${mb(frames.bytes)} · no code running` }));
      bakedBadge.hidden = false;
      studio.classList.add('is-baked');
      bakePanel.setPlaying(true);
      kick();
    } catch (err) {
      if (!alive || token !== bakedLoad) return;
      hideViewerMsg();
      if (err.status === 401) { ctx.signedOut(); return; }
      toast(err.message, { kind: 'error', timeout: 7000 });
    }
  }

  function showViewerMsg(text, error = false) {
    viewerMsg.textContent = text;
    viewerMsg.classList.toggle('error', error);
    viewerMsg.hidden = false;
  }
  function hideViewerMsg() { viewerMsg.hidden = true; }

  // ---- the loop ----------------------------------------------------------------------------------

  // One rAF loop advances the clock and pumps frames to the sandbox. It runs only while
  // playing or while the sandbox still owes us a frame, and never while the tab is hidden
  // or the 3D view is off screen. (The viewer draws on its own, only when something changed.)
  let last = 0;
  let statsAt = 0;
  let onScreen = true;
  const tick = (now) => loop(now);
  function kick() {
    if (!raf && alive && S.ready && onScreen && !document.hidden) raf = requestAnimationFrame(tick);
  }
  function loop(now) {
    raf = 0;
    if (!alive) return;
    const dt = last && now - last < 250 ? (now - last) / 1000 : 0;
    last = now;
    const B = S.baked;
    const duration = B ? B.frames.seconds : S.duration;
    if (S.playing) {
      S.t += dt * S.speed;
      if (S.t >= duration) S.t %= duration;
    }
    if (B) {
      // Baked frames: pick the frame for this time straight from the file.
      const i = Math.min(B.frames.frameCount - 1, Math.floor(S.t * B.frames.fps));
      if (i !== B.index && viewer) { B.index = i; viewer.setColors(B.frames.frameAt(i, B.rgb)); }
    } else if (runtime) runtime.pump(S.t, S.playing);
    transport.set(S.playing, S.t, duration, now);
    if (now - statsAt > 1000 && runtime) {
      statsAt = now;
      const st = runtime.stats;
      transport.setStats(B ? `baked · ${B.frames.fps} fps` : runtime.ready && S.playing ? `${Math.round(st.fps)} fps · ${st.ms ? st.ms.toFixed(1) : '–'} ms` : '');
    }
    if (S.playing || (!B && runtime && runtime.pending(S.t))) kick();
    else last = 0;
  }

  function syncViewButtons(name) {
    for (const b of viewBar.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === name));
    viewSelect.value = name || '';
  }

  let io = null;
  function onVisibility() {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; last = 0; } else kick();
  }
  function watchVisibility() {
    document.addEventListener('visibilitychange', onVisibility);
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        onScreen = entries[entries.length - 1].isIntersecting;
        if (onScreen) kick(); else { cancelAnimationFrame(raf); raf = 0; last = 0; }
      });
      io.observe(viewerWrap);
    }
    if (viewer) viewer.onViewChange = syncViewButtons;
    syncViewButtons(viewer?.currentView);
  }

  // ---- view lifecycle ------------------------------------------------------------------------------

  return {
    isDirty,
    discard() { S.saved = snapshot(); },
    unmount() {
      alive = false;
      cancelAnimationFrame(raf);
      compileSoon.cancel();
      updateSaveState.cancel();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('visibilitychange', onVisibility);
      narrowMq.removeEventListener('change', placeBake);
      bakePanel.destroy();
      bakedLoad++;
      S.baked = null;
      if (io) io.disconnect();
      if (runtime) runtime.destroy();
      if (viewer) viewer.destroy();
    },
  };
}
