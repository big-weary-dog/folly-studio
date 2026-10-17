// The Studio's module chain: which module of the selected layer is selected (its code in the editor, its params
// in the panel, each param modulatable), the chain panel's edits, and the shelf to add modules from.
// The shelf and the modulate dialog load when first opened.
import { ChainPanel } from './chain.js';
import { toast } from './dom.js';
import { KIND_LABELS, makeModule, moduleFromLibrary } from './model.js';
import { ParamsPanel } from './params.js';

const MAX_MODULES = 8;
const GLOBAL_NAMES = ['energy', 'speed', 'level', 'hue', 'saturation'];

// createChain({ S, ui, editor, status, selected(), changed(opts?), refresh() }) → { module(), select(id), show(),
//   render(), refreshParams() }
export function createChain(o) {
  const { S, ui, editor, status } = o;
  const picked = new Map();       // layer id → its selected module's id
  const layer = () => o.selected();
  function module() {
    const l = layer();
    if (!l) return null;
    const id = picked.get(l.id);
    return l.modules.find((m) => m.id === id) || l.modules.find((m) => m.kind === 'source') || l.modules[0] || null;
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
      const mods = layer()?.modules;
      const i = mods ? mods.findIndex((m) => m.id === id) : -1, j = i + dir;
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
    onAdd: () => import('./chain-shelf.js').then(({ openShelf }) => openShelf({ library: S.library, onPick: add })),
  });

  /** A library entry (or a blank) after the selected module; a filter that reads its input (x) takes the nearest
   * hidden source as it. */
  function add(entry) {
    const l = layer();
    if (!l) return;
    if (l.modules.length >= MAX_MODULES) return toast(`A layer has at most ${MAX_MODULES} modules.`, { kind: 'warn' });
    const m = entry.blank ? makeModule({ kind: entry.kind }) : moduleFromLibrary(entry);
    const cur = module();
    const at = cur ? l.modules.indexOf(cur) + 1 : l.modules.length;
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
  const globals = () => [...GLOBAL_NAMES, ...Object.keys(S.look.globals?.macros || {})];
  const params = new ParamsPanel(ui.paramsBody, {
    onChange: (key, value) => setParams((p) => ({ ...p, [key]: value })),
    onReset: (key) => setParams((p) => { delete p[key]; return p; }),
    onResetAll: () => setParams(() => ({})),
    onModulate: (key, p) => import('./modulate.js').then(({ openModulate }) => openModulate({ label: p.label, p,
      binding: module()?.params?.[key], globals: globals(),
      onApply: (b) => setParams((q) => { if (b) q[key] = b; else delete q[key]; return q; }) })),
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
