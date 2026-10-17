// The Studio's panes, built once: toolbar, 3D view, groups, layers and settings, the bottom dock (code, timeline
// and look tabs, a fold toggle, the splitter that sizes it), and the phone tabs. Returns the elements the other
// studio modules fill.
import { h, humanize, label, nextId, switchBox } from './dom.js';

// Narrow screens stack the panels under the 3D view and switch them with these tabs.
export const TABS = ['layers', 'code', 'time', 'groups', 'look'];
// Below this height the code editor starts folded, so the cathedral gets the room.
const SHORT = '(max-height: 899px)';
const button = (props) => h('button', { type: 'button', ...props });
const pane = (cls, label, ...kids) => h('section',
  { class: `pane pane-${cls}`, dataset: { pane: cls }, 'aria-label': label }, ...kids);
const paneHead = (title, ...extra) => h('div', { class: 'pane-head' },
  h('h2', { class: 'pane-title', text: title }), ...extra);

/**
 * buildLayout({ store, tab, setTab, actions, onDock(id) }) → elements. `actions`: menu and Look-tab handlers; onDock:
 * a dock tab shows.
 */
export function buildLayout({ store, tab, setTab, actions, onDock }) {
  const ui = {};
  ui.studio = h('div', { class: 'studio', dataset: { tab } });

  // toolbar
  ui.titleInput = h('input', { class: 'look-title', type: 'text', maxlength: 120, 'aria-label': 'Look title',
    placeholder: 'Untitled look', spellcheck: false });
  ui.saveState = h('span', { class: 'save-state', 'aria-live': 'polite' });
  ui.share = ['share-toggle', 'share-toggle big'].map((cls) => switchBox('Share to gallery', cls));
  ui.saveBtn = button({ class: 'btn primary save-btn', text: 'Save', title: 'Save (Ctrl+S)' });
  ui.menuBtn = button({ class: 'btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', text: 'Export' });
  const item = (text, onClick, cls) => button({ role: 'menuitem', class: cls, text,
    onClick: () => { ui.closeMenu(); onClick(); } });
  ui.menu = h('div', { class: 'menu', role: 'menu', hidden: true },
    item('Export .fseq…', actions.exportFseq, 'wide-only'), item('Export look JSON', actions.exportJson),
    item('Look details…', actions.details));
  ui.menuWrap = h('div', { class: 'menu-wrap' }, ui.menuBtn, ui.menu);
  const bar = h('div', { class: 'studio-bar' }, h('div', { class: 'bar-title' }, ui.titleInput, ui.saveState),
    h('div', { class: 'bar-actions' }, ui.share[0].el, ui.menuWrap, ui.saveBtn));
  ui.notice = h('div', { class: 'studio-notice', role: 'note', hidden: true });

  // the 3D view
  ui.canvas = h('canvas', { class: 'viewer-canvas', tabindex: 0, 'aria-label': '3D preview of the cathedral. Drag to '
    + 'orbit, scroll or pinch to zoom, right-drag or two fingers to pan, double-click to reset. With focus: arrow keys '
    + 'orbit, Alt+arrows pan, plus and minus zoom.' });
  ui.viewBar = h('div', { class: 'view-bar', role: 'group', 'aria-label': 'Camera views' });
  ui.viewSelect = h('select', { class: 'view-select', 'aria-label': 'Camera view' });
  ui.viewCompact = h('div', { class: 'view-compact' }, ui.viewSelect);
  ui.viewerMsg = h('div', { class: 'viewer-msg', role: 'status', hidden: true });
  ui.bakedText = h('span', { class: 'baked-text' });
  ui.bakedLive = button({ class: 'btn small', text: 'Back to live' });
  ui.bakedBadge = h('div', { class: 'baked-badge', role: 'status', hidden: true },
    h('span', { class: 'baked-dot', 'aria-hidden': 'true' }), ui.bakedText, ui.bakedLive);
  ui.viewerWrap = h('div', { class: 'viewer' }, ui.canvas, ui.viewBar, ui.viewCompact, ui.viewerMsg, ui.bakedBadge);
  ui.sandboxHost = h('div', { class: 'sandbox-host', 'aria-hidden': 'true' });
  ui.paneViewer = h('section', { class: 'pane pane-viewer', 'aria-label': 'Preview' }, ui.viewerWrap);

  // tabs (narrow screens)
  ui.tabBtns = TABS.map((id) => button({ class: 'tab', dataset: { tab: id }, text: humanize(id),
    onClick: () => setTab(id) }));
  const tabs = h('nav', { class: 'studio-tabs', 'aria-label': 'Studio panels' }, ui.tabBtns);

  ui.groupsFor = h('span', { class: 'pane-sub' });
  ui.groupsBody = h('div', { class: 'pane-body tree-wrap' });
  ui.bakeSlotWide = h('div', { class: 'bake-slot' });
  const paneGroups = pane('groups', 'Groups', paneHead('Groups', ui.groupsFor), ui.groupsBody, ui.bakeSlotWide);
  const icon = (label, title, text) => button({ class: 'icon-btn', 'aria-label': label, title, text });
  ui.addBtn = button({ class: 'btn small primary', text: '+ Add', title: 'Add a layer from the library' });
  ui.dupBtn = icon('Duplicate layer', 'Duplicate layer', '⧉');
  ui.delBtn = icon('Delete layer', 'Delete layer', '🗑');
  ui.upBtn = icon('Move layer up', 'Move up (toward the top)', '↑');
  ui.downBtn = icon('Move layer down', 'Move down (toward the bottom)', '↓');
  ui.layersBody = h('div', { class: 'pane-body' });
  const paneLayers = pane('layers', 'Layers',
    paneHead('Layers', h('div', { class: 'pane-tools' }, ui.upBtn, ui.downBtn, ui.dupBtn, ui.delBtn, ui.addBtn)),
    ui.layersBody);

  ui.layerTitle = h('input', { type: 'text', class: 'layer-title-input', maxlength: 80,
    spellcheck: false });
  ui.paramsBody = h('div', { class: 'params-host' });
  ui.playsOn = h('span', { class: 'plays-on-text' });
  ui.chainBody = h('div', { class: 'chain-host' });
  ui.moduleTitle = h('input', { type: 'text', class: 'module-title-input', maxlength: 80, spellcheck: false });
  ui.moduleKind = h('span', { class: 'kind-badge' });
  const paneParams = pane('params', 'Layer settings', paneHead('Settings'),
    h('div', { class: 'pane-body params-wrap' },
      h('div', { class: 'field layer-title-field' },
        label(ui.layerTitle, 'Layer name'), ui.layerTitle),
      h('p', { class: 'plays-on' }, h('span', { class: 'plays-on-label', text: 'Plays on ' }), ui.playsOn,
        button({ class: 'btn small ghost narrow-only', text: 'Change', onClick: () => setTab('groups') })),
      ui.chainBody,
      h('div', { class: 'field module-title-field' }, h('div', { class: 'module-label' },
        label(ui.moduleTitle, 'Module name'), ui.moduleKind), ui.moduleTitle),
      ui.paramsBody));
  const side = h('div', { class: 'side', dataset: { pane: 'layers' } }, paneLayers, paneParams);

  // The bottom dock (wide screens): Code, Timeline and Look tabs; phones: a Time tab.
  ui.codeFor = h('span', { class: 'pane-sub dock-code-only' });
  ui.codeIssue = h('span', { class: 'dock-issue', hidden: true });
  ui.dock = createDock(ui.studio, store, [ui.codeFor, ui.codeIssue], onDock);
  ui.timeBody = h('div', { class: 'pane-body time-body' });
  const paneTime = pane('time', 'Timeline', ui.timeBody);

  // "Look" tab (narrow screens): what the toolbar and the header hold on a wide screen
  ui.myLooks = h('ul', { class: 'mini-list' });
  ui.bakeSlotNarrow = h('div', { class: 'bake-slot' });
  ui.globalsSlotNarrow = h('div', { class: 'globals-slot' });
  const paneLook = pane('look', 'Look', h('div', { class: 'pane-body look-body' },
    ui.globalsSlotNarrow, ui.bakeSlotNarrow, ui.share[1].el,
    h('div', { class: 'look-actions' }, button({ class: 'btn', text: 'Look details', onClick: actions.details }),
      button({ class: 'btn', text: 'Export look JSON', onClick: actions.exportJson })),
    h('h3', { class: 'look-h', text: 'My looks' }), ui.myLooks,
    h('p', { class: 'look-links' }, h('a', { href: '/ideas', text: 'Ideas' }),
      h('a', { href: '/looks', text: 'All my looks' }), h('a', { href: '/gallery', text: 'Gallery' }))));

  ui.studio.append(bar, ui.notice, paneGroups, ui.paneViewer, ui.dock.splitter, tabs, side, ui.dock.pane, paneTime,
    paneLook, ui.sandboxHost);

  ui.closeMenu = () => { ui.menu.hidden = true; ui.menuBtn.setAttribute('aria-expanded', 'false'); };
  ui.menuBtn.addEventListener('click', () => {
    const open = ui.menu.hidden;
    ui.menu.hidden = !open;
    ui.menuBtn.setAttribute('aria-expanded', String(open));
    if (open) ui.menu.querySelector('button').focus();
  });
  ui.menu.addEventListener('keydown', (e) => {
    const items = [...ui.menu.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); ui.closeMenu(); ui.menuBtn.focus(); }
  });
  return ui;
}

const DOCK_TABS = ['Code', 'Timeline', 'Look'];

/** The dock: studio gets data-dock and .code-collapsed; store is pref(); extras sit in its head with the code tab. */
function createDock(studio, store, extras, onShow) {
  const [codeBody, timelineBody, lookBody] = ['pane-body code-body', 'tl-body', 'pane-body look-dock']
    .map((cls) => h('div', { class: cls, id: nextId('dock') }));
  const toolsSlot = h('div', { class: 'dock-tools' });
  const fold = h('button', { type: 'button', class: 'btn small ghost collapse-btn', 'aria-expanded': 'true',
    'aria-controls': `${codeBody.id} ${timelineBody.id} ${lookBody.id}`,
    title: 'Fold the panel away to give the 3D view more room',
    onClick: () => setFolded(!studio.classList.contains('code-collapsed')) });
  const tabBtns = DOCK_TABS.map((text) => h('button', { type: 'button', class: 'dock-tab', 'aria-pressed': 'false',
    dataset: { dock: text.toLowerCase() }, text, onClick: () => show(text.toLowerCase()) }));
  const head = h('div', { class: 'pane-head dock-head' },
    h('div', { class: 'dock-tabs', role: 'group', 'aria-label': 'Bottom panel' }, tabBtns), extras, toolsSlot, fold);
  const pane = h('section', { class: 'pane pane-code', dataset: { pane: 'code' },
    'aria-label': 'Code, timeline and look' }, head, codeBody, timelineBody, lookBody);
  const splitter = h('div', { class: 'splitter', role: 'separator', 'aria-orientation': 'horizontal', tabindex: 0,
    'aria-label': 'Resize code editor', 'aria-valuemin': 15, 'aria-valuemax': 75 });

  const known = (id) => (DOCK_TABS.some((t) => t.toLowerCase() === id) ? id : 'timeline');
  let tab = known(store('studio.dock'));

  function show(id, { unfold = true } = {}) {
    tab = known(id);
    studio.dataset.dock = tab;
    for (const b of tabBtns) b.setAttribute('aria-pressed', String(b.dataset.dock === tab));
    store('studio.dock', tab);
    onShow(tab);
    if (unfold) setFolded(false);
    else setFolded(studio.classList.contains('code-collapsed'), { remember: false });
  }

  function setFolded(on, { remember = true } = {}) {
    studio.classList.toggle('code-collapsed', on);
    fold.setAttribute('aria-expanded', String(!on));
    fold.textContent = on ? `Show ${tab}` : 'Hide';
    if (remember) store('studio.dockFolded', on ? '1' : '0');
  }

  const folded = store('studio.dockFolded');
  studio.classList.toggle('code-collapsed', folded === null ? tab === 'code' && matchMedia(SHORT).matches
    : folded === '1');
  show(tab, { unfold: false });

  // The splitter sizes the code editor (a share of the Studio's height).
  const savedSplit = +store('studio.split');
  if (savedSplit >= 15 && savedSplit <= 75) studio.style.setProperty('--code-h', `${savedSplit}%`);
  function setSplit(pct) {
    studio.style.setProperty('--code-h', `${pct.toFixed(1)}%`);
    splitter.setAttribute('aria-valuenow', String(Math.round(pct)));
    store('studio.split', pct.toFixed(1));
  }
  let drag = null;
  splitter.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, h: pane.getBoundingClientRect().height, total: studio.getBoundingClientRect().height };
    splitter.setPointerCapture(e.pointerId);
    studio.classList.add('resizing');
  });
  splitter.addEventListener('pointermove', (e) => {
    if (drag) setSplit(Math.min(75, Math.max(15, ((drag.h + drag.y - e.clientY) / drag.total) * 100)));
  });
  const end = () => { if (drag) { drag = null; studio.classList.remove('resizing'); } };
  splitter.addEventListener('pointerup', end);
  splitter.addEventListener('pointercancel', end);
  splitter.addEventListener('keydown', (e) => {
    const cur = parseFloat(studio.style.getPropertyValue('--code-h')) || 36;
    if (e.key === 'ArrowUp') { e.preventDefault(); setSplit(Math.min(75, cur + 4)); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSplit(Math.max(15, cur - 4)); }
  });

  return { pane, splitter, codeBody, timelineBody, lookBody, toolsSlot, show };
}
