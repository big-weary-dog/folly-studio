// Groups tree (xLights-style model groups). Checkboxes assign groups to the selected layer;
// hovering or focusing a row highlights its LEDs on the model; the pin button keeps it lit.
import { h, nextId } from './dom.js';

export class GroupsTree {
  /**
   * @param {HTMLElement} container
   * @param {object} cathedral
   * @param {ReturnType<import('./model.js').buildGroupIndex>} index
   * @param {{ onToggle: (id, checked) => void, onHover: (id|null) => void, onPin: (id|null) => void }} handlers
   */
  constructor(container, cathedral, index, handlers) {
    this.index = index;
    this.handlers = handlers;
    this.rows = new Map();        // id → { li, box, toggle, pin }
    this.pinned = null;
    this.layer = null;
    this.readOnly = false;
    this.el = h('ul', { class: 'tree', 'aria-label': 'Cathedral groups' });
    this.empty = h('p', { class: 'pane-hint', text: 'Select a layer to choose where it plays.' });
    container.append(this.empty, this.el);
    for (const g of index.children.get(null) || []) this.el.append(this._item(g, 0));
    this.el.addEventListener('pointerleave', () => this.handlers.onHover(null));
    this.el.addEventListener('focusout', (e) => { if (!this.el.contains(e.relatedTarget)) this.handlers.onHover(null); });
  }

  _item(g, depth) {
    const kids = this.index.children.get(g.id) || [];
    const boxId = nextId('grp');
    const box = h('input', { type: 'checkbox', id: boxId, class: 'tree-box' });
    box.addEventListener('change', () => this.handlers.onToggle(g.id, box.checked));
    const expanded = depth < 1;
    const childList = kids.length ? h('ul', { class: 'tree-children', role: 'group', hidden: !expanded }) : null;
    const toggle = kids.length
      ? h('button', { type: 'button', class: 'tree-toggle', 'aria-expanded': String(expanded), 'aria-label': `${expanded ? 'Collapse' : 'Expand'} ${g.name}` })
      : h('span', { class: 'tree-toggle spacer', 'aria-hidden': 'true' });
    if (childList) {
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${g.name}`);
        childList.hidden = !open;
      });
    }
    const n = this.index.counts.get(g.id) || 0;
    const pin = h('button', { type: 'button', class: 'tree-pin', 'aria-pressed': 'false',
      'aria-label': `Highlight ${g.name} on the model`, title: 'Highlight on the model' });
    pin.addEventListener('click', () => this.pin(this.pinned === g.id ? null : g.id));
    const row = h('div', { class: 'tree-row', dataset: { id: g.id } },
      toggle, box,
      h('label', { for: boxId, class: 'tree-label', text: g.name, title: g.name }),
      h('span', { class: 'tree-count', text: n.toLocaleString() }),
      pin);
    row.style.setProperty('--depth', String(depth));
    row.addEventListener('pointerenter', () => this.handlers.onHover(g.id));
    row.addEventListener('focusin', () => this.handlers.onHover(g.id));
    const li = h('li', { class: 'tree-item' }, row, childList);
    this.rows.set(g.id, { li, box, toggle, pin, row });
    if (childList) for (const k of kids) childList.append(this._item(k, depth + 1));
    return li;
  }

  pin(id) {
    if (this.pinned && this.rows.get(this.pinned)) {
      const r = this.rows.get(this.pinned);
      r.pin.setAttribute('aria-pressed', 'false');
      r.row.classList.remove('pinned');
    }
    this.pinned = id;
    if (id && this.rows.get(id)) {
      const r = this.rows.get(id);
      r.pin.setAttribute('aria-pressed', 'true');
      r.row.classList.add('pinned');
    }
    this.handlers.onPin(id);
  }

  /** Reflect a layer's groups (or none). */
  setLayer(layer, { readOnly = false } = {}) {
    this.layer = layer;
    this.readOnly = readOnly;
    this.empty.hidden = !!layer;
    const sel = new Set(layer ? layer.groups : []);
    // ancestors of selected groups get an "indeterminate" mark; descendants are implied
    const partial = new Set();
    for (const id of sel) for (const a of this.index.ancestors(id)) partial.add(a);
    for (const [id, r] of this.rows) {
      const checked = sel.has(id);
      r.box.checked = checked;
      r.box.indeterminate = !checked && partial.has(id);
      r.box.disabled = !layer;
      const implied = !checked && this.index.ancestors(id).some((a) => sel.has(a));
      r.row.classList.toggle('implied', implied);
      r.row.classList.toggle('checked', checked);
    }
  }

  /** Expand the branches that hold the layer's groups, so they are visible. */
  reveal(ids) {
    for (const id of ids || []) {
      for (const a of this.index.ancestors(id)) {
        const r = this.rows.get(a);
        if (r && r.toggle.getAttribute('aria-expanded') === 'false') r.toggle.click();
      }
    }
  }
}
