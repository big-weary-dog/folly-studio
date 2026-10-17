// Layer stack: the look's layers, top of the list = top of the composite (index 0 is the
// bottom, like xLights rows reversed). Rows are keyed so dragging a level slider survives
// re-renders.
import { h, nextId } from './dom.js';
import { BLEND_MODES } from './model.js';

const STATUS_TEXT = {
  ok: 'Running',
  pending: 'Compiling…',
  compile: 'Compile error',
  runtime: 'Runtime error',
  hung: 'Hung — paused',
  probation: 'Paused while finding a hung layer',
  muted: 'Muted',
};

export class LayerStack {
  constructor(container, handlers) {
    this.h = handlers;
    this.rows = new Map();
    this.list = h('ol', { class: 'layer-list', 'aria-label': 'Layers, top first' });
    container.append(this.list);
    this.state = null;
  }

  render(state) {
    // state: { layers, selectedId, status: Map, muted: Set, solo: Set, readOnly }
    this.state = state;
    const ordered = [...state.layers].reverse();
    const keep = new Set(ordered.map((l) => l.id));
    for (const [id, r] of this.rows) if (!keep.has(id)) { r.li.remove(); this.rows.delete(id); }
    ordered.forEach((layer, i) => {
      let r = this.rows.get(layer.id);
      if (!r) { r = this._row(layer); this.rows.set(layer.id, r); }
      if (this.list.children[i] !== r.li) this.list.insertBefore(r.li, this.list.children[i] || null);
      this._update(r, layer, state.layers.length - 1 - i);
    });
  }

  _row(layer) {
    const id = layer.id;
    const levelId = nextId('lvl'), blendId = nextId('bl');
    const r = {};
    r.name = h('button', { type: 'button', class: 'layer-name' });
    r.name.addEventListener('click', () => this.h.onSelect(id));
    r.dot = h('span', { class: 'status-dot', 'aria-hidden': 'true' });
    r.statusText = h('span', { class: 'sr-only' });
    r.mute = h('button', { type: 'button', class: 'ms-btn mute', text: 'M', 'aria-pressed': 'false' });
    r.mute.addEventListener('click', () => this.h.onToggleMute(id));
    r.solo = h('button', { type: 'button', class: 'ms-btn solo', text: 'S', 'aria-pressed': 'false' });
    r.solo.addEventListener('click', () => this.h.onToggleSolo(id));
    r.blend = h('select', { id: blendId, class: 'blend-select' },
      BLEND_MODES.map((b) => h('option', { value: b.value, text: b.label, title: b.help })));
    r.blend.addEventListener('change', () => this.h.onChange(id, { blend: r.blend.value }));
    r.level = h('input', { type: 'range', id: levelId, class: 'level', min: 0, max: 1, step: 0.01 });
    r.levelOut = h('output', { class: 'level-out', for: levelId });
    r.level.addEventListener('input', () => {
      r.levelOut.textContent = `${Math.round(r.level.value * 100)}%`;
      this.h.onChange(id, { level: +r.level.value }, { live: true });
    });
    r.level.addEventListener('change', () => this.h.onChange(id, { level: +r.level.value }));
    r.index = h('span', { class: 'layer-index', 'aria-hidden': 'true' });
    r.groups = h('span', { class: 'layer-groups' });
    r.blendLabel = h('label', { for: blendId, class: 'sr-only' });
    r.levelLabel = h('label', { for: levelId, class: 'sr-only' });
    r.li = h('li', { class: 'layer' },
      h('div', { class: 'layer-top' },
        r.index,
        h('div', { class: 'ms', role: 'group', 'aria-label': 'Mute and solo' }, r.mute, r.solo),
        r.name,
        r.dot, r.statusText),
      h('div', { class: 'layer-bottom' },
        r.blendLabel, r.blend, r.levelLabel, r.level, r.levelOut),
      r.groups);
    r.li.addEventListener('click', (e) => {
      if (e.target === r.li || e.target.classList.contains('layer-top') || e.target.classList.contains('layer-bottom') || e.target === r.groups) this.h.onSelect(id);
    });
    return r;
  }

  _update(r, layer, index) {
    const st = this.state;
    const selected = layer.id === st.selectedId;
    const status = st.status.get(layer.id) || { kind: 'pending' };
    const muted = st.muted.has(layer.id);
    const soloed = st.solo.has(layer.id);
    const silent = muted || (st.solo.size > 0 && !soloed);
    const title = layer.title || 'Layer';
    r.li.classList.toggle('selected', selected);
    r.li.classList.toggle('silent', silent);
    r.li.dataset.status = status.kind;
    r.li.dataset.blend = layer.blend;
    r.index.textContent = String(index + 1);
    r.name.textContent = title;
    r.name.setAttribute('aria-current', selected ? 'true' : 'false');
    r.name.title = `${title} — ${STATUS_TEXT[status.kind] || status.kind}${status.message ? `: ${status.message}` : ''}`;
    r.statusText.textContent = `, ${STATUS_TEXT[status.kind] || status.kind}`;
    r.dot.title = STATUS_TEXT[status.kind] || '';
    r.mute.setAttribute('aria-pressed', String(muted));
    r.mute.setAttribute('aria-label', `Mute ${title}`);
    r.solo.setAttribute('aria-pressed', String(soloed));
    r.solo.setAttribute('aria-label', `Solo ${title}`);
    r.blendLabel.textContent = `Blend for ${title}`;
    r.levelLabel.textContent = `Level for ${title}`;
    if (r.blend.value !== layer.blend) r.blend.value = layer.blend;
    if (+r.level.value !== layer.level) r.level.value = String(layer.level);
    r.levelOut.textContent = `${Math.round(layer.level * 100)}%`;
    r.groups.textContent = st.groupNames ? st.groupNames(layer.groups) : layer.groups.join(', ');
  }
}
