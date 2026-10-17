// The groups tree: checkboxes assign groups to the selected layer; hovering or focusing a row lights
// its LEDs on the model; the pin button keeps them lit.
import { h, nextId } from './dom.js';

export class GroupsTree {
  /** new GroupsTree(container, cathedral, index (buildGroupIndex), { onToggle(id, on), onHover(id), onPin(id) }) */
  constructor(container, cathedral, index, handlers) {
    Object.assign(this, { index, handlers, pinned: null });
    this.rows = new Map();        // id → { li, box, toggle, pin, row }
    this.el = h('ul', { class: 'tree', 'aria-label': 'Cathedral groups' });
    this.empty = h('p', { class: 'pane-hint', text: 'Select a layer to choose where it plays.' });
    container.append(this.empty, this.el);
    for (const g of index.children.get(null) || []) this.el.append(this._item(g, 0));
    this.el.addEventListener('pointerleave', () => this.handlers.onHover(null));
    this.el.addEventListener('focusout', (e) => !this.el.contains(e.relatedTarget) && this.handlers.onHover(null));
  }

  _item(g, depth) {
    const kids = this.index.children.get(g.id) || [];
    const boxId = nextId('grp');
    const box = h('input', { type: 'checkbox', id: boxId, class: 'tree-box' });
    box.addEventListener('change', () => this.handlers.onToggle(g.id, box.checked));
    const childList = kids.length ? h('ul', { class: 'tree-children', role: 'group' }) : null;
    const toggle = kids.length ? h('button', { type: 'button', class: 'tree-toggle' })
      : h('span', { class: 'tree-toggle spacer', 'aria-hidden': 'true' });
    const expand = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${g.name}`);
      childList.hidden = !open;
    };
    if (childList) {
      expand(depth < 1);
      toggle.addEventListener('click', () => expand(toggle.getAttribute('aria-expanded') !== 'true'));
    }
    const n = this.index.counts.get(g.id) || 0;
    const pin = h('button', { type: 'button', class: 'tree-pin', 'aria-pressed': 'false',
      'aria-label': `Highlight ${g.name} on the model`, title: 'Highlight on the model',
      onClick: () => this.pin(this.pinned === g.id ? null : g.id) });
    const row = h('div', { class: 'tree-row', dataset: { id: g.id } }, toggle, box,
      h('label', { for: boxId, class: 'tree-label', text: g.name, title: g.name }),
      h('span', { class: 'tree-count', text: n.toLocaleString() }), pin);
    row.style.setProperty('--depth', String(depth));
    row.addEventListener('pointerenter', () => this.handlers.onHover(g.id));
    row.addEventListener('focusin', () => this.handlers.onHover(g.id));
    const li = h('li', { class: 'tree-item' }, row, childList);
    this.rows.set(g.id, { li, box, toggle, pin, row });
    if (childList) for (const k of kids) childList.append(this._item(k, depth + 1));
    return li;
  }

  pin(id) {
    const mark = (gid, on) => {
      const r = gid && this.rows.get(gid);
      if (!r) return;
      r.pin.setAttribute('aria-pressed', String(on));
      r.row.classList.toggle('pinned', on);
    };
    mark(this.pinned, false);
    mark(this.pinned = id, true);
    this.handlers.onPin(id);
  }

  /** Reflect a layer's groups (or none). */
  setLayer(layer) {
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
      r.row.classList.toggle('implied', !checked && this.index.ancestors(id).some((a) => sel.has(a)));
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
