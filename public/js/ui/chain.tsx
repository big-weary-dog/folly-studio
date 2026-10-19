// The selected layer's settings: its name and groups, its module chain (SPEC "Modules": a row per module with its
// kind, name, state, enable, reorder, delete, and how a source combines or which input a filter reads; phones: enable
// and select only), its Soften row, the selected module's name and its params.
import type { Module } from '../../../shared/schemas/look.ts';
import type { LibraryEntry } from '../../../shared/schemas/rig.ts';
import { cx, Field, toast } from './kit.tsx';
import { BLEND_MODES, KIND_LABELS, makeModule, moduleFromLibrary } from './model.ts';
import { ParamsPanel } from './params.tsx';
import type { Preview } from './preview.ts';
import { SoftenRow } from './soften.tsx';
import type { Studio } from './studio-store.ts';

const STATE_TEXT: Record<string, string> = { ok: 'Running', off: 'Off', pending: 'Compiling…',
  compile: 'Compile error', runtime: 'Runtime error', hung: 'Hung' };
const INPUT_ONLY = 'input';
const MAX_MODULES = 8;
type Props = { st: Studio; pv: Preview };

export function ChainPane({ st, pv }: Props) {
  const l = st.selected.value, m = st.module.value;
  return (
    <section class="pane pane-params" data-pane="params" aria-label="Layer settings">
      <div class="pane-head"><h2 class="pane-title">Settings</h2></div>
      <div class="pane-body params-wrap">
        <Field label="Layer name">{(id) => <input type="text" id={id} class="layer-title-input" maxlength={80}
          spellcheck={false} value={l?.title ?? ''} disabled={!l} onInput={(e) => {
            const title = e.currentTarget.value;
            if (l) st.editLayer(l.id, () => ({ title }));
          }} onBlur={() => {
            if (l && !st.selected.peek()?.title.trim()) st.editLayer(l.id, () => ({ title: 'Layer' }));
          }} />}</Field>
        <Field label="Plays on" class="plays-on">{l ? st.groupNames(l.groups) : '—'}
          <button type="button" class="btn small ghost narrow-only" onClick={() => st.setTab('groups')}>Change</button>
        </Field>
        <div class="chain-host"><Chain st={st} pv={pv} /></div>
        <SoftenRow st={st} l={l} />
        <Field label="Module name" class="module-title-field">{(id) => <><input type="text" id={id}
          class="module-title-input" maxlength={80} spellcheck={false} value={m?.title ?? ''} disabled={!m}
          onInput={(e) => {
            const title = e.currentTarget.value;
            if (l && m) st.editModule(l.id, m.id, () => ({ title }));
          }} /><span class="kind-badge" data-kind={m?.kind ?? ''}>{m ? KIND_LABELS[m.kind] : ''}</span></>}</Field>
        <div class="params-host"><ParamsPanel st={st} /></div>
      </div>
    </section>);
}

function Chain({ st, pv }: Props) {
  const l = st.selected.value, mods = l?.modules || [], sel = st.module.value;
  const setMods = (fn: (mods: Module[]) => Module[]) => {
    if (l) st.editLayer(l.id, (x) => ({ modules: fn(x.modules.slice()) }));
  };

  /** A library entry (or a blank) after the selected module, so it works on it; a filter that reads its input (x)
   * takes the nearest hidden source as it. */
  function add(entry: LibraryEntry | { kind: Module['kind']; blank: true }) {
    const layer = st.selected.peek(), cur = st.module.peek();
    if (!layer) return;
    if (layer.modules.length >= MAX_MODULES) {
      return toast(`A layer has at most ${MAX_MODULES} modules.`, { kind: 'warn' });
    }
    const m = 'blank' in entry ? makeModule({ kind: entry.kind }) : moduleFromLibrary(entry);
    const i = cur ? layer.modules.indexOf(cur) : -1, at = i < 0 ? layer.modules.length : i + 1;
    if (m.kind === 'filter' && /\bx\s*\[/.test(m.code)) {
      const src = layer.modules.slice(0, at).reverse().find((x) => x.kind === 'source' && x.as === 'input');
      if (src) m.input = src.id;
    }
    setMods((list) => { list.splice(at, 0, m); return list; });
    st.pickModule(m.id);
  }
  function remove(m: Module, i: number) {
    if (mods.length <= 1 || !l) return;
    setMods((list) => list.filter((x) => x.id !== m.id));
    toast(`Deleted “${m.title}”.`, { action: { label: 'Undo', onClick: () => {
      st.editLayer(l.id, (x) => ({ modules: [...x.modules.slice(0, i), m, ...x.modules.slice(i)] }));
      st.pickModule(m.id);
    } } });
  }
  const move = (i: number, j: number) => setMods((list) => {
    if (j >= 0 && j < list.length) list.splice(j, 0, list.splice(i, 1)[0]);
    return list;
  });
  const shelf = () => import('./shelf.tsx').then(({ openShelf }) => openShelf({ library: st.data.library, onPick: add,
    audition: { pv, layer: l || undefined, moduleId: sel?.id } }));
  const first = mods.findIndex((x) => x.kind === 'source' && x.as !== 'input' && x.enabled !== false);
  return (
    <section class="chain" aria-label="Module chain">
      <div class="chain-head"><h3 class="chain-title">Chain</h3>
        <button type="button" class="btn small chain-add wide-only"
          title="Add a warp, source or filter from the library" disabled={!l || mods.length >= MAX_MODULES}
          onClick={shelf}>+ Module</button></div>
      <p class="pane-hint" hidden={!!l}>Select a layer to see its modules.</p>
      <ol class="chain-list" aria-label="Modules, first to last">
        {l && mods.map((m, i) => <ModuleRow key={m.id} m={m} i={i} mods={mods} first={first} selected={m.id === sel?.id}
          state={st.status.module(l.id, m)} pick={() => st.pickModule(m.id)} remove={() => remove(m, i)}
          move={(dir) => move(i, i + dir)} set={(patch) => st.editModule(l.id, m.id, () => patch)} />)}
      </ol>
    </section>);
}

function ModuleRow({ m, i, mods, first, selected, state, pick, remove, move, set }: { m: Module; i: number;
  mods: Module[]; first: number; selected: boolean; state: { kind: string; message?: string }; pick: () => void;
  remove: () => void; move: (dir: number) => void; set: (patch: Partial<Module>) => void }) {
  const title = m.title || KIND_LABELS[m.kind], filter = m.kind === 'filter';
  const icon = (text: string, label: string, disabled: boolean, onClick: () => void) => <button type="button"
    class="icon-btn wide-only" aria-label={label} title={label} disabled={disabled} onClick={onClick}>{text}</button>;
  // The row's select as a patch: a source's blend (or input only), a filter's input.
  const opts = filter ? [['', 'No input'], ...mods.slice(0, i).filter((s) => s.kind === 'source')
    .map((s) => [s.id, s.title || 'Source'])]
    : [['', i === first ? 'Over (first)' : 'Add (default)'], ...BLEND_MODES.map((b) => [b.value, b.label]),
      ['under', 'Under'], [INPUT_ONLY, 'Input only (hidden)']];
  const value = filter ? m.input || '' : m.as === 'input' ? INPUT_ONLY : m.blend || '';
  return (
    <li class={cx('chain-row', selected && 'selected', m.enabled === false && 'off')} data-kind={m.kind}
      data-status={state.kind} onClick={(e) => { if (e.target === e.currentTarget) pick(); }}>
      <div class="chain-top"><span class="kind-badge">{KIND_LABELS[m.kind]}</span>
        <button type="button" class="chain-name" aria-current={selected} onClick={pick}
          title={`${title} — ${STATE_TEXT[state.kind] || state.kind}${state.message ? `: ${state.message}` : ''}`}>
          {title}</button>
        <span class="status-dot" aria-hidden="true" />
        <input type="checkbox" class="switch chain-on" aria-label={`${title} on`} checked={m.enabled !== false}
          onChange={(e) => {
            const on = e.currentTarget.checked;
            e.currentTarget.checked = !on;      // the look decides
            set({ enabled: on ? undefined : false });
          }} />
        {icon('↑', 'Move earlier', i === 0, () => move(-1))}
        {icon('↓', 'Move later', i === mods.length - 1, () => move(+1))}
        {icon('🗑', 'Delete module', mods.length <= 1, remove)}</div>
      {m.kind !== 'warp' && <Field label={filter ? 'Input' : 'Combine'} class="chain-bottom wide-only">
        {(id) => <select id={id} class="chain-select" value={opts.some(([v]) => v === value) ? value : ''}
          onChange={(e) => {
            const v = e.currentTarget.value;
            set(filter ? { input: v || undefined } : v === INPUT_ONLY ? { as: 'input', blend: undefined }
              : { as: undefined, blend: (v || undefined) as Module['blend'] });
          }}>{opts.map(([v, t]) => <option value={v}>{t}</option>)}</select>}</Field>}
    </li>);
}
