// The selected layer's module chain (SPEC "Modules"), first module first: a row per module with its kind's glass
// badge, its name (select it to edit its code and params), its state, an enable switch, reorder and delete, and
// for a source how it combines (or "input only"), for a filter which source is its input. Phones get it read-only
// but for the switch and selecting. Rows are keyed, so a control keeps focus across re-renders.
import { h, nextId } from './dom.js';
import { BLEND_MODES, KIND_LABELS } from './model.js';

const STATE_TEXT = { ok: 'Running', off: 'Off', pending: 'Compiling…', compile: 'Compile error',
  runtime: 'Runtime error', hung: 'Hung' };
const INPUT_ONLY = 'input';

export class ChainPanel {
  // handlers: { onSelect(id), onToggle(id, on), onMove(id, dir), onDelete(id), onAdd(), onSet(id, patch) }
  constructor(container, handlers) {
    Object.assign(this, { h: handlers, rows: new Map(), state: null });
    this.list = h('ol', { class: 'chain-list', 'aria-label': 'Modules, first to last' });
    this.addBtn = h('button', { type: 'button', class: 'btn small chain-add wide-only', text: '+ Module',
      title: 'Add a warp, source or filter from the library', onClick: () => this.h.onAdd() });
    this.empty = h('p', { class: 'pane-hint', text: 'Select a layer to see its modules.', hidden: true });
    this.el = h('section', { class: 'chain', 'aria-label': 'Module chain' },
      h('div', { class: 'chain-head' }, h('h3', { class: 'chain-title', text: 'Chain' }), this.addBtn),
      this.empty, this.list);
    container.append(this.el);
  }

  /** state: { layer, selectedId, status(m) → { kind, message? } } */
  render(state) {
    this.state = state;
    const mods = state.layer ? state.layer.modules : [];
    this.empty.hidden = !!state.layer;
    this.addBtn.disabled = !state.layer || mods.length >= 8;
    const keep = new Set(mods.map((m) => m.id));
    for (const [id, r] of this.rows) if (!keep.has(id)) { r.li.remove(); this.rows.delete(id); }
    mods.forEach((m, i) => {
      let r = this.rows.get(m.id);
      if (!r) { r = this._row(m.id); this.rows.set(m.id, r); }
      if (this.list.children[i] !== r.li) this.list.insertBefore(r.li, this.list.children[i] || null);
      this._update(r, m, i, mods);
    });
  }

  _row(id) {
    const r = {}, ctl = nextId('mod');
    r.badge = h('span', { class: 'kind-badge' });
    r.name = h('button', { type: 'button', class: 'chain-name', onClick: () => this.h.onSelect(id) });
    r.dot = h('span', { class: 'status-dot', 'aria-hidden': 'true' });
    r.on = h('input', { type: 'checkbox', class: 'switch chain-on',
      onChange: () => this.h.onToggle(id, r.on.checked) });
    const icon = (text, label, onClick) => h('button', { type: 'button', class: 'icon-btn wide-only', text,
      'aria-label': label, title: label, onClick });
    r.up = icon('↑', 'Move earlier', () => this.h.onMove(id, -1));
    r.down = icon('↓', 'Move later', () => this.h.onMove(id, +1));
    r.del = icon('🗑', 'Delete module', () => this.h.onDelete(id));
    r.how = h('select', { id: ctl, class: 'chain-select wide-only' });
    r.how.addEventListener('change', () => this.h.onSet(id, this._howPatch(r)));
    r.howLabel = h('label', { for: ctl, class: 'chain-how-label wide-only' });
    r.li = h('li', { class: 'chain-row' },
      h('div', { class: 'chain-top' }, r.badge, r.name, r.dot, r.on, r.up, r.down, r.del),
      h('div', { class: 'chain-bottom' }, r.howLabel, r.how));
    r.li.addEventListener('click', (e) => { if (e.target === r.li) this.h.onSelect(id); });
    return r;
  }

  /** The row's select as a patch: a source's blend (or input only), a filter's input. */
  _howPatch(r) {
    const v = r.how.value;
    if (r.kind === 'filter') return { input: v || undefined };
    return v === INPUT_ONLY ? { as: 'input', blend: undefined } : { as: undefined, blend: v || undefined };
  }

  _update(r, m, i, mods) {
    const st = this.state.status(m) || { kind: 'pending' };
    const title = m.title || KIND_LABELS[m.kind];
    const selected = m.id === this.state.selectedId;
    r.kind = m.kind;
    r.li.dataset.kind = m.kind;
    r.li.dataset.status = st.kind;
    r.li.classList.toggle('selected', selected);
    r.li.classList.toggle('off', m.enabled === false);
    r.badge.textContent = KIND_LABELS[m.kind];
    r.name.textContent = title;
    r.name.setAttribute('aria-current', selected ? 'true' : 'false');
    r.name.title = `${title} — ${STATE_TEXT[st.kind] || st.kind}${st.message ? `: ${st.message}` : ''}`;
    r.on.checked = m.enabled !== false;
    r.on.setAttribute('aria-label', `${title} on`);
    r.up.disabled = i === 0;
    r.down.disabled = i === mods.length - 1;
    r.del.disabled = mods.length <= 1;
    const warp = m.kind === 'warp';
    r.how.hidden = r.howLabel.hidden = warp;
    if (warp) return;
    const opts = m.kind === 'filter'
      ? [['', 'No input'], ...mods.slice(0, i).filter((s) => s.kind === 'source')
        .map((s) => [s.id, s.title || 'Source'])]
      : [['', i === firstShown(mods) ? 'Over (first)' : 'Add (default)'],
        ...BLEND_MODES.map((b) => [b.value, b.label]), [INPUT_ONLY, 'Input only (hidden)']];
    const sig = JSON.stringify(opts);
    if (r.sig !== sig) {
      r.sig = sig;
      r.how.replaceChildren(...opts.map(([value, text]) => h('option', { value, text })));
    }
    r.howLabel.textContent = m.kind === 'filter' ? 'Input' : 'Combine';
    const value = m.kind === 'filter' ? m.input || '' : m.as === 'input' ? INPUT_ONLY : m.blend || '';
    if (r.how.value !== value) r.how.value = opts.some(([v]) => v === value) ? value : '';
  }
}

/** Index of the first source drawn into the chain (it goes over nothing). */
function firstShown(mods) {
  return mods.findIndex((m) => m.kind === 'source' && m.as !== 'input' && m.enabled !== false);
}
