// The Studio's bottom dock (wide screens; phones use Studio tabs): Code, Timeline and Look (the globals) tabs, a
// fold toggle, and the splitter that sizes the code editor. The code editor starts folded on short screens.
import { h, nextId } from './dom.js';

const TABS = [{ id: 'code', label: 'Code' }, { id: 'timeline', label: 'Timeline' }, { id: 'look', label: 'Look' }];

// createDock({ studio (gets data-dock, .code-collapsed), store(key, value?) (pref), extras (code-only head
//   bits), short, onShow(id) }) → { pane, splitter, codeBody, timelineBody, lookBody, toolsSlot, show(id),
//   setFolded(on), tab }
export function createDock({ studio, store, extras = [], short = false, onShow = () => {} }) {
  const codeBody = h('div', { class: 'pane-body code-body', id: nextId('dock') });
  const timelineBody = h('div', { class: 'tl-body', id: nextId('dock') });
  const lookBody = h('div', { class: 'pane-body look-dock', id: nextId('dock') });
  const toolsSlot = h('div', { class: 'dock-tools' });
  const fold = h('button', { type: 'button', class: 'btn small ghost collapse-btn', 'aria-expanded': 'true',
    'aria-controls': `${codeBody.id} ${timelineBody.id} ${lookBody.id}`,
    title: 'Fold the panel away to give the 3D view more room',
    onClick: () => setFolded(!studio.classList.contains('code-collapsed')) });
  const tabBtns = TABS.map((t) => h('button', { type: 'button', class: 'dock-tab', dataset: { dock: t.id },
    'aria-pressed': 'false', text: t.label, onClick: () => show(t.id) }));
  const head = h('div', { class: 'pane-head dock-head' },
    h('div', { class: 'dock-tabs', role: 'group', 'aria-label': 'Bottom panel' }, tabBtns), extras, toolsSlot, fold);
  const pane = h('section', { class: 'pane pane-code', dataset: { pane: 'code' },
    'aria-label': 'Code, timeline and look' }, head, codeBody, timelineBody, lookBody);
  const splitter = h('div', { class: 'splitter', role: 'separator', 'aria-orientation': 'horizontal', tabindex: 0,
    'aria-label': 'Resize code editor', 'aria-valuemin': 15, 'aria-valuemax': 75 });

  let tab = TABS.some((t) => t.id === store('studio.dock')) ? store('studio.dock') : 'timeline';
  const label = () => TABS.find((t) => t.id === tab).label;

  function show(id, { unfold = true } = {}) {
    tab = TABS.some((t) => t.id === id) ? id : 'timeline';
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
    fold.textContent = on ? `Show ${label().toLowerCase()}` : 'Hide';
    if (remember) store('studio.dockFolded', on ? '1' : '0');
  }

  const pref = store('studio.dockFolded');
  studio.classList.toggle('code-collapsed', pref === null ? tab === 'code' && short : pref === '1');
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
    drag = { y: e.clientY, h: pane.getBoundingClientRect().height,
      total: studio.getBoundingClientRect().height };
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

  return { pane, splitter, codeBody, timelineBody, lookBody, toolsSlot, show, setFolded, get tab() { return tab; } };
}
