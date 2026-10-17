// The Studio's panes, built once: toolbar, 3D view, groups, layers and settings, the bottom dock
// (code and timeline), and the phone tabs. Returns the elements the other studio-*.js modules fill.
import { h, label, switchBox } from './dom.js';
import { createDock } from './studio-dock.js';

// Narrow screens stack the panels under the 3D view and switch them with these tabs.
export const TABS = [
  { id: 'layers', label: 'Layers' }, { id: 'code', label: 'Code' }, { id: 'time', label: 'Time' },
  { id: 'groups', label: 'Groups' }, { id: 'look', label: 'Look' },
];
// Below this height the code editor starts folded, so the cathedral gets the room.
const SHORT = '(max-height: 899px)';
const button = (props) => h('button', { type: 'button', ...props });
const pane = (cls, label, ...kids) => h('section',
  { class: `pane pane-${cls}`, dataset: { pane: cls }, 'aria-label': label }, ...kids);
const paneHead = (title, ...extra) => h('div', { class: 'pane-head' },
  h('h2', { class: 'pane-title', text: title }), ...extra);

/** buildLayout({ store, tab, setTab, actions }) → elements. `actions`: menu and Look-tab handlers. */
export function buildLayout({ store, tab, setTab, actions }) {
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
  ui.tabBtns = TABS.map((t) => button({ class: 'tab', dataset: { tab: t.id }, text: t.label,
    onClick: () => setTab(t.id) }));
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
  const paneParams = pane('params', 'Layer settings', paneHead('Settings'),
    h('div', { class: 'pane-body params-wrap' },
      h('div', { class: 'field layer-title-field' },
        label(ui.layerTitle, 'Layer name'), ui.layerTitle),
      h('p', { class: 'plays-on' }, h('span', { class: 'plays-on-label', text: 'Plays on ' }), ui.playsOn,
        button({ class: 'btn small ghost narrow-only', text: 'Change', onClick: () => setTab('groups') })),
      ui.paramsBody));
  const side = h('div', { class: 'side', dataset: { pane: 'layers' } }, paneLayers, paneParams);

  // The bottom dock (wide screens): Timeline and Code tabs (studio-dock.js); phones: a Time tab.
  ui.codeFor = h('span', { class: 'pane-sub dock-code-only' });
  ui.codeIssue = h('span', { class: 'dock-issue', hidden: true });
  const short = matchMedia(SHORT).matches;
  ui.dock = createDock({ studio: ui.studio, store, extras: [ui.codeFor, ui.codeIssue], short });
  ui.timeBody = h('div', { class: 'pane-body time-body' });
  const paneTime = pane('time', 'Timeline', ui.timeBody);

  // "Look" tab (narrow screens): what the toolbar and the header hold on a wide screen
  ui.myLooks = h('ul', { class: 'mini-list' });
  ui.bakeSlotNarrow = h('div', { class: 'bake-slot' });
  const paneLook = pane('look', 'Look', h('div', { class: 'pane-body look-body' },
    ui.bakeSlotNarrow, ui.share[1].el,
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
