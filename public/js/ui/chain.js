// The selected layer's module chain (SPEC "Modules"): a row per module (kind, name, state, enable, reorder, delete,
// how a source combines or which input a filter reads; phones: enable and select only). createChain() wires it to
// the editor, the params and the shelf; createLayerStatus() keeps what the sandbox says about each layer and module.
import { h, keyed, nextId, toast } from './dom.js';
import { BLEND_MODES, KIND_LABELS, makeModule, moduleFromLibrary } from './model.js';
import { ParamsPanel } from './params.js';

const STATE_TEXT = { ok: 'Running', off: 'Off', pending: 'Compiling…', compile: 'Compile error',
  runtime: 'Runtime error', hung: 'Hung' };
const INPUT_ONLY = 'input';
const MAX_MODULES = 8;
const GLOBAL_NAMES = ['energy', 'speed', 'level', 'hue', 'saturation'];

class ChainPanel {
  // handlers: { onSelect(id), onToggle(id, on), onMove(id, dir), onDelete(id), onAdd(), onSet(id, patch) }
  constructor(container, handlers) {
    Object.assign(this, { h: handlers, rows: new Map(), state: null });
    this.list = h('ol', { class: 'chain-list', 'aria-label': 'Modules, first to last' });
    this.addBtn = h('button', { type: 'button', class: 'btn small chain-add wide-only', text: '+ Module',
      title: 'Add a warp, source or filter from the library', onClick: () => this.h.onAdd() });
    this.empty = h('p', { class: 'pane-hint', text: 'Select a layer to see its modules.', hidden: true });
    container.append(h('section', { class: 'chain', 'aria-label': 'Module chain' },
      h('div', { class: 'chain-head' }, h('h3', { class: 'chain-title', text: 'Chain' }), this.addBtn),
      this.empty, this.list));
  }

  /** state: { layer, selectedId, status(m) → { kind, message? } } */
  render(state) {
    this.state = state;
    const mods = state.layer ? state.layer.modules : [];
    this.empty.hidden = !!state.layer;
    this.addBtn.disabled = !state.layer || mods.length >= MAX_MODULES;
    keyed(this.list, this.rows, mods, (m) => m.id, (m) => this._row(m.id), (r, m, i) => this._update(r, m, i, mods));
  }

  _row(id) {
    const r = {}, ctl = nextId('mod'), on = this.h;
    const icon = (text, label, onClick) => h('button', { type: 'button', class: 'icon-btn wide-only', text,
      'aria-label': label, title: label, onClick });
    r.badge = h('span', { class: 'kind-badge' });
    r.name = h('button', { type: 'button', class: 'chain-name', onClick: () => on.onSelect(id) });
    r.dot = h('span', { class: 'status-dot', 'aria-hidden': 'true' });
    r.on = h('input', { type: 'checkbox', class: 'switch chain-on', onChange: () => on.onToggle(id, r.on.checked) });
    r.up = icon('↑', 'Move earlier', () => on.onMove(id, -1));
    r.down = icon('↓', 'Move later', () => on.onMove(id, +1));
    r.del = icon('🗑', 'Delete module', () => on.onDelete(id));
    // The row's select as a patch: a source's blend (or input only), a filter's input.
    r.how = h('select', { id: ctl, class: 'chain-select wide-only', onChange: () => {
      const v = r.how.value;
      on.onSet(id, r.kind === 'filter' ? { input: v || undefined }
        : v === INPUT_ONLY ? { as: 'input', blend: undefined } : { as: undefined, blend: v || undefined });
    } });
    r.howLabel = h('label', { for: ctl, class: 'chain-how-label wide-only' });
    r.el = h('li', { class: 'chain-row' },
      h('div', { class: 'chain-top' }, r.badge, r.name, r.dot, r.on, r.up, r.down, r.del),
      h('div', { class: 'chain-bottom' }, r.howLabel, r.how));
    r.el.addEventListener('click', (e) => { if (e.target === r.el) on.onSelect(id); });
    return r;
  }

  _update(r, m, i, mods) {
    const st = this.state.status(m) || { kind: 'pending' };
    const title = m.title || KIND_LABELS[m.kind], selected = m.id === this.state.selectedId;
    r.kind = m.kind;
    Object.assign(r.el.dataset, { kind: m.kind, status: st.kind });
    r.el.classList.toggle('selected', selected);
    r.el.classList.toggle('off', m.enabled === false);
    r.badge.textContent = KIND_LABELS[m.kind];
    r.name.textContent = title;
    r.name.setAttribute('aria-current', String(selected));
    r.name.title = `${title} — ${STATE_TEXT[st.kind] || st.kind}${st.message ? `: ${st.message}` : ''}`;
    r.on.checked = m.enabled !== false;
    r.on.setAttribute('aria-label', `${title} on`);
    r.up.disabled = i === 0;
    r.down.disabled = i === mods.length - 1;
    r.del.disabled = mods.length <= 1;
    r.how.hidden = r.howLabel.hidden = m.kind === 'warp';
    if (m.kind === 'warp') return;
    const first = mods.findIndex((x) => x.kind === 'source' && x.as !== 'input' && x.enabled !== false);
    const opts = m.kind === 'filter'
      ? [['', 'No input'], ...mods.slice(0, i).filter((s) => s.kind === 'source')
        .map((s) => [s.id, s.title || 'Source'])]
      : [['', i === first ? 'Over (first)' : 'Add (default)'], ...BLEND_MODES.map((b) => [b.value, b.label]),
        [INPUT_ONLY, 'Input only (hidden)']];
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

// createChain({ S, ui, editor, status, preview, selected(), changed(opts?), refresh() }) → { module(), select(id),
//   show(), render(), refreshParams() }
export function createChain(o) {
  const { S, ui, editor, status } = o;
  const picked = new Map();       // layer id → its selected module's id
  const layer = () => o.selected();
  function module() {
    const l = layer(), id = l && picked.get(l.id);
    return l ? l.modules.find((m) => m.id === id) || l.modules.find((m) => m.kind === 'source') || l.modules[0] : null;
  }
  const edit = (id, fn) => {
    const m = layer()?.modules.find((x) => x.id === id);
    if (m) { fn(m); o.changed(); }
  };

  const panel = new ChainPanel(ui.chainBody, {
    onSelect: (id) => select(id),
    onToggle: (id, on) => edit(id, (m) => { if (on) delete m.enabled; else m.enabled = false; }),
    onSet: (id, patch) => edit(id, (m) => {
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete m[k]; else m[k] = v;
    }),
    onMove: (id, dir) => {
      const mods = layer()?.modules, i = mods ? mods.findIndex((m) => m.id === id) : -1, j = i + dir;
      if (i < 0 || j < 0 || j >= mods.length) return;
      mods.splice(j, 0, mods.splice(i, 1)[0]);
      o.changed();
    },
    onDelete: (id) => {
      const l = layer(), i = l ? l.modules.findIndex((m) => m.id === id) : -1;
      if (i < 0 || l.modules.length <= 1) return;
      const [m] = l.modules.splice(i, 1);
      o.changed();
      show();
      toast(`Deleted “${m.title}”.`, { action: { label: 'Undo', onClick: () => {
        l.modules.splice(Math.min(i, l.modules.length), 0, m);
        o.changed();
        select(m.id);
      } } });
    },
    onAdd: () => import('./chain-shelf.js').then(({ openShelf }) => openShelf({ library: S.library, onPick: add,
      audition: { preview: o.preview, layer: layer(), moduleId: module()?.id } })),
  });

  /** A library entry (or a blank) after the selected module; a filter that reads its input (x) takes the nearest
   * hidden source as it. */
  function add(entry) {
    const l = layer();
    if (!l) return;
    if (l.modules.length >= MAX_MODULES) return toast(`A layer has at most ${MAX_MODULES} modules.`, { kind: 'warn' });
    const m = entry.blank ? makeModule({ kind: entry.kind }) : moduleFromLibrary(entry);
    const cur = module(), i = l.modules.indexOf(cur);    // a warp goes before a selected source, so it moves it
    const at = i < 0 ? l.modules.length : i + (m.kind === 'warp' && cur.kind === 'source' ? 0 : 1);
    if (m.kind === 'filter' && /\bx\s*\[/.test(m.code)) {
      const src = l.modules.slice(0, at).reverse().find((x) => x.kind === 'source' && x.as === 'input');
      if (src) m.input = src.id;
    }
    l.modules.splice(at, 0, m);
    picked.set(l.id, m.id);
    o.changed();
    select(m.id);
  }

  const setParams = (fn) => {
    const m = module();
    if (!m) return;
    m.params = fn({ ...m.params });
    o.changed({ stack: false });
  };
  const params = new ParamsPanel(ui.paramsBody, {
    onChange: (key, value) => setParams((p) => ({ ...p, [key]: value })),
    onReset: (key) => setParams((p) => { delete p[key]; return p; }),
    onResetAll: () => setParams(() => ({})),
    globals: () => [...GLOBAL_NAMES, ...Object.keys(S.look.globals?.macros || {})],
    binding: (key) => module()?.params?.[key],
    onModulate: (key, b) => setParams((q) => { if (b) q[key] = b; else delete q[key]; return q; }),
  });

  ui.moduleTitle.addEventListener('input', () => {
    const m = module();
    if (!m) return;
    m.title = ui.moduleTitle.value;
    o.changed({ look: false });
    showName();
  });

  function showName() {
    const l = layer(), m = module();
    ui.codeFor.textContent = l ? `${l.title}${m && l.modules.length > 1 ? ` › ${m.title}` : ''}` : '';
  }

  /** The selected module in the editor and the module name field. */
  function show() {
    const m = module();
    editor.setValue(m ? m.code : '');
    editor.setDisabled(!m, m ? '' : 'Add a layer to write code.');
    ui.moduleTitle.value = m ? m.title : '';
    ui.moduleTitle.disabled = !m;
    ui.moduleKind.textContent = m ? KIND_LABELS[m.kind] : '';
    ui.moduleKind.dataset.kind = m ? m.kind : '';
    showName();
  }

  function select(id) {
    const l = layer();
    if (l && id) picked.set(l.id, id);
    show();
    o.refresh();
  }

  return {
    module, select, show,
    render() {
      const l = layer();
      panel.render({ layer: l, selectedId: module()?.id, status: (m) => status.module(l.id, m) });
    },
    refreshParams() {
      const l = layer(), m = module();
      if (!m) return params.set(null, null, {});
      const { schema, note } = status.params(l.id, m);
      params.set(`${l.id}/${m.id}`, schema, m.params || {}, note);
    },
  };
}

// What the sandbox says: compile results, the last code that compiled (it runs while new code is broken), params
// schemas, runtime errors.
const RUNTIME_ERROR_HOLD_MS = 1200;
const HUNG_RE = /^Pattern hung\b/;    // the sandbox's message for a layer it paused
export const ISSUE_LABELS = { compile: 'Compile error', runtime: 'Runtime error', hung: 'Hung' };
const K = (layerId, moduleId) => `${layerId}/${moduleId}`;

/** createLayerStatus({ layerById, silent(id) }) */
export function createLayerStatus({ layerById, silent }) {
  const compiled = new Map();     // module key → { ok, error, params, code } (latest reply)
  const good = new Map();         // module key → last code that compiled
  const bad = new Map();          // module key → { code, error } for the newest code that failed to compile
  const schemas = new Map();      // module key → last good params schema
  const layerErr = new Map();     // layer id → an error not of one module (a group, say)
  const runtimeErr = new Map();   // layer id → { error, module, at }
  let shownKey = '';
  const moduleIn = (l, id) => (l && l.modules ? l.modules.find((m) => m.id === id) : null);

  const S = {
    /** A compile report → true when a module falls back to its last good code (send the look again). */
    compiled(layers) {
      let fallback = false;
      for (const r of layers) {
        const l = layerById(r.id);
        let moduleFailed = false;
        for (const mr of r.modules || []) {
          const key = K(r.id, mr.id), m = moduleIn(l, mr.id);
          compiled.set(key, { ok: !!mr.ok, error: mr.error || '', params: mr.params || null, code: mr.code });
          if (mr.ok) {
            good.set(key, mr.code);
            if (mr.params) schemas.set(key, mr.params);
            if (m && m.code === mr.code) bad.delete(key);
          } else {
            moduleFailed = true;
            bad.set(key, { code: mr.code, error: mr.error || 'Compile error' });
            if (good.has(key) && good.get(key) !== mr.code && m && m.code === mr.code) fallback = true;
          }
        }
        if (!r.ok && !moduleFailed) layerErr.set(r.id, r.error || 'error'); else layerErr.delete(r.id);
        if (r.ok) runtimeErr.delete(r.id);
      }
      return fallback;
    },

    /** A frame's errors → true when what the panels show changed. */
    frameErrors(errors) {
      if (!errors.length && !runtimeErr.size) return false;      // the usual case: nothing to do
      const now = performance.now();
      for (const e of errors) runtimeErr.set(e.id, { error: String(e.error || 'error'), module: e.module, at: now });
      let key = '';
      for (const [id, e] of runtimeErr) {
        if (now - e.at > RUNTIME_ERROR_HOLD_MS) runtimeErr.delete(id);
        else key += `${id}${e.error}|`;
      }
      if (key === shownKey) return false;
      shownKey = key;
      return true;
    },

    /** The code to run: the module's own, or its last good code while the new one fails. */
    codeFor(layerId, m) {
      const key = K(layerId, m.id), b = bad.get(key);
      return b && b.code === m.code && good.has(key) ? good.get(key) : m.code;
    },

    /** A module's state: { kind: ok | off | pending | compile | runtime | hung, message? }. */
    module(layerId, m) {
      const key = K(layerId, m.id), b = bad.get(key);
      if (b && b.code === m.code) return { kind: 'compile', message: b.error };
      const c = compiled.get(key);
      if (!c || c.code !== m.code) return { kind: 'pending', message: b ? b.error : '' };
      const rt = runtimeErr.get(layerId);
      if (rt && rt.module === m.id) return { kind: HUNG_RE.test(rt.error) ? 'hung' : 'runtime', message: rt.error };
      return { kind: m.enabled === false ? 'off' : 'ok' };
    },

    /** A layer's state: { kind: ok | muted | pending | compile | runtime | hung, message? }. */
    of(id) {
      const l = layerById(id);
      if (!l) return { kind: 'pending' };
      let pending = null;
      for (const m of l.modules || []) {
        const st = S.module(id, m);
        if (st.kind === 'compile' && m.enabled !== false) {
          return { kind: 'compile', message: `${m.title}: ${st.message}` };
        }
        if (st.kind === 'pending') pending ||= st;
      }
      if (layerErr.has(id)) return { kind: 'compile', message: layerErr.get(id) };
      if (pending) return pending;
      const rt = runtimeErr.get(id);
      if (rt) return { kind: HUNG_RE.test(rt.error) ? 'hung' : 'runtime', message: rt.error };
      return { kind: silent(id) ? 'muted' : 'ok' };
    },

    /** The editor's problem for a module: null or { kind: compile | runtime | hung, message, running? }. */
    problem(layerId, m) {
      if (!m) return null;
      const st = S.module(layerId, m), key = K(layerId, m.id);
      if (st.kind === 'compile' || (st.kind === 'pending' && st.message)) {
        return { kind: HUNG_RE.test(st.message) ? 'hung' : 'compile', message: st.message, running: good.has(key) };
      }
      const rt = runtimeErr.get(layerId);
      if (rt && (rt.module === m.id || rt.module == null)) {
        return { kind: HUNG_RE.test(rt.error) ? 'hung' : 'runtime', message: rt.error };
      }
      return layerErr.has(layerId) ? { kind: 'compile', message: layerErr.get(layerId) } : null;
    },

    /** A module's params schema, and a note when there is none. */
    params(layerId, m) {
      const key = K(layerId, m.id), c = compiled.get(key);
      const schema = (c && c.ok && c.params) || schemas.get(key) || null;
      const note = bad.has(key) && !schemas.get(key) ? 'Fix the code’s error to get its controls.'
        : !c && !schema ? 'Compiling…' : '';
      return { schema, note: note ? { message: note } : undefined };
    },
  };
  return S;
}
