// The layer stack, top of the list = top of the composite (index 0 is the bottom), with rows keyed so dragging a
// level slider survives re-renders; what the Studio does to layers: add from the library, duplicate, delete (with
// undo), move, rename; and the groups tree, where checkboxes say which groups the selected layer plays on, and
// hovering or focusing a row (or its pin) lights its LEDs on the model.
import { h, keyed, nextId, toast } from './dom.js';
import { BLEND_MODES, cleanLayer, layerFromPattern, makeLayer } from './model.js';

const STATUS_TEXT = { ok: 'Running', pending: 'Compiling…', compile: 'Compile error', runtime: 'Runtime error',
  hung: 'Hung — paused', muted: 'Muted' };

export class LayerStack {
  constructor(container, handlers) {
    Object.assign(this, { h: handlers, rows: new Map(), state: null,
      list: h('ol', { class: 'layer-list', 'aria-label': 'Layers, top first' }) });
    container.append(this.list);
  }

  /** state: { layers, selectedId, status: Map, muted: Set, solo: Set, heavy: Map id → ms, groupNames(ids) } */
  render(state) {
    this.state = state;
    const n = state.layers.length;
    keyed(this.list, this.rows, [...state.layers].reverse(), (l) => l.id, (l) => this._row(l.id),
      (r, l, i) => this._update(r, l, n - 1 - i));
  }

  _row(id) {
    const r = {}, levelId = nextId('lvl'), blendId = nextId('bl'), on = this.h;
    const ms = (cls, text, toggle) => h('button', { type: 'button', class: `ms-btn ${cls}`, text,
      'aria-pressed': 'false', onClick: () => toggle(id) });
    r.name = h('button', { type: 'button', class: 'layer-name', onClick: () => on.onSelect(id) });
    r.heavy = h('span', { class: 'kind-badge layer-heavy', text: 'Heavy', hidden: true });
    r.dot = h('span', { class: 'status-dot', 'aria-hidden': 'true' });
    r.statusText = h('span', { class: 'sr-only' });
    r.mute = ms('mute', 'M', on.onToggleMute);
    r.solo = ms('solo', 'S', on.onToggleSolo);
    r.blend = h('select', { id: blendId, class: 'blend-select',
      onChange: () => on.onChange(id, { blend: r.blend.value }) },
    BLEND_MODES.map((b) => h('option', { value: b.value, text: b.label, title: b.help })));
    r.level = h('input', { type: 'range', id: levelId, class: 'level', min: 0, max: 1, step: 0.01,
      onChange: () => on.onChange(id, { level: +r.level.value }) });
    r.levelOut = h('output', { class: 'level-out', for: levelId });
    r.level.addEventListener('input', () => {
      r.levelOut.textContent = `${Math.round(r.level.value * 100)}%`;
      on.onChange(id, { level: +r.level.value }, { live: true });
    });
    r.index = h('span', { class: 'layer-index', 'aria-hidden': 'true' });
    r.groups = h('span', { class: 'layer-groups' });
    r.blendLabel = h('label', { for: blendId, class: 'sr-only' });
    r.levelLabel = h('label', { for: levelId, class: 'sr-only' });
    r.el = h('li', { class: 'layer' },
      h('div', { class: 'layer-top' }, r.index,
        h('div', { class: 'ms', role: 'group', 'aria-label': 'Mute and solo' }, r.mute, r.solo),
        r.name, r.heavy, r.dot, r.statusText),
      h('div', { class: 'layer-bottom' }, r.blendLabel, r.blend, r.levelLabel, r.level, r.levelOut),
      r.groups);
    r.el.addEventListener('click', (e) => {   // the row's empty space selects it too
      const t = e.target;
      if (t === r.el || t === r.groups || /^layer-(top|bottom)$/.test(t.className)) on.onSelect(id);
    });
    return r;
  }

  _update(r, layer, index) {
    const st = this.state, id = layer.id;
    const status = st.status.get(id) || { kind: 'pending' };
    const muted = st.muted.has(id), soloed = st.solo.has(id), selected = id === st.selectedId;
    const title = layer.title || 'Layer', said = STATUS_TEXT[status.kind] || status.kind;
    r.el.classList.toggle('selected', selected);
    r.el.classList.toggle('silent', muted || (st.solo.size > 0 && !soloed));
    Object.assign(r.el.dataset, { status: status.kind, blend: layer.blend });
    r.index.textContent = String(index + 1);
    r.name.textContent = title;
    r.name.setAttribute('aria-current', String(selected));
    r.name.title = `${title} — ${said}${status.message ? `: ${status.message}` : ''}`;
    r.statusText.textContent = `, ${said}`;
    r.dot.title = STATUS_TEXT[status.kind] || '';
    const ms = st.heavy?.get(id);
    r.heavy.hidden = !ms;
    if (ms) r.heavy.title = `${ms.toFixed(1)} ms a frame: over 40 % of a 40 fps frame, so phones preview it slower.`;
    r.mute.setAttribute('aria-pressed', String(muted));
    r.mute.setAttribute('aria-label', `Mute ${title}`);
    r.solo.setAttribute('aria-pressed', String(soloed));
    r.solo.setAttribute('aria-label', `Solo ${title}`);
    r.blendLabel.textContent = `Blend for ${title}`;
    r.levelLabel.textContent = `Level for ${title}`;
    if (r.blend.value !== layer.blend) r.blend.value = layer.blend;
    if (+r.level.value !== layer.level) r.level.value = String(layer.level);
    r.levelOut.textContent = `${Math.round(layer.level * 100)}%`;
    r.groups.textContent = st.groupNames(layer.groups);
  }
}

// createLayerOps({ S, ui, preview, changed(opts?), select(id), selected(), setTab(id, opts), narrow(), groupsTree(),
//   groupNames(ids), showLayerName(l) }) → { toggleGroup }
export function createLayerOps({ S, ui, preview, changed, select, selected, setTab, narrow, groupsTree, groupNames,
  showLayerName }) {
  const layers = () => S.look.layers;

  function insertLayer(layer, at) {
    layers().splice(at ?? (selected() ? layers().indexOf(selected()) + 1 : layers().length), 0, layer);
    changed();
    select(layer.id);
  }

  // The library's sources on the shelf (chain-shelf.js), each auditioned as a layer over the selected one's groups.
  ui.addBtn.addEventListener('click', () => import('./chain-shelf.js').then(({ openShelf }) => openShelf({
    title: 'Add a layer', only: 'source', library: S.library,
    audition: { preview, layer: selected() || { groups: [] } },
    onPick: (e) => {
      insertLayer(e.blank ? makeLayer({ title: 'New layer' }, S.cathedral) : layerFromPattern(e, S.cathedral));
      setTab('code', { onlyNarrow: true });
      if (e.blank && !narrow()) ui.dock.show('code');   // a blank layer is for writing code
    } })));
  ui.dupBtn.addEventListener('click', () => {
    const l = selected();
    if (l) insertLayer(makeLayer({ ...cleanLayer(l), title: `${l.title} copy` }, S.cathedral), layers().indexOf(l) + 1);
  });
  ui.delBtn.addEventListener('click', () => {
    const l = selected();
    if (!l) return;
    const i = layers().indexOf(l);
    layers().splice(i, 1);
    S.muted.delete(l.id);
    S.solo.delete(l.id);
    changed();
    select(layers()[Math.min(i, layers().length - 1)]?.id ?? null);
    const undo = () => insertLayer(l, Math.min(i, layers().length));
    toast(`Deleted “${l.title}”.`, { action: { label: 'Undo', onClick: undo } });
  });
  const move = (dir) => {
    const l = selected(), i = layers().indexOf(l), j = i + dir;
    if (!l || j < 0 || j >= layers().length) return;
    layers().splice(j, 0, layers().splice(i, 1)[0]);
    changed();
  };
  ui.upBtn.addEventListener('click', () => move(+1));
  ui.downBtn.addEventListener('click', () => move(-1));

  ui.layerTitle.addEventListener('input', () => {
    const l = selected();
    if (!l) return;
    l.title = ui.layerTitle.value;
    showLayerName(l);
    changed({ look: false });
  });
  ui.layerTitle.addEventListener('blur', () => {
    const l = selected();
    if (l && !l.title.trim()) { l.title = ui.layerTitle.value = 'Layer'; changed({ look: false }); }
  });

  /** Tick or untick a group for the selected layer, which keeps at least one. */
  function toggleGroup(id, checked) {
    const l = selected();
    if (!l) return;
    const set = new Set(l.groups);
    if (checked) set.add(id); else set.delete(id);
    if (set.size) l.groups = [...set];
    else toast('A layer needs at least one group. Tick another group first.', { kind: 'warn' });
    groupsTree().setLayer(l);
    if (!set.size) return;
    ui.playsOn.textContent = groupNames(l.groups);
    changed();
  }

  return { toggleGroup };
}

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
