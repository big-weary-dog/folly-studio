// The selected layer's settings: its name and groups (a drawer), its module chain (SPEC "Modules": a row per module
// with a grip to drag it, its kind, Custom when it is not a library module, name, enable, reorder, delete, and how a
// source combines or which input a filter reads; phones: drag, enable and select only), its Soften row, the selected
// module's name (a library module's is the library's) and its params. The chain runs down a came into
// the layer: each module joins it (a source by how it combines), and each warp and filter spans what it works on,
// everything above it.
import { useRef } from 'preact/hooks';

import type { Module } from '../../../shared/schemas/look.ts';
import { standardTitle } from '../../../shared/standard-modules.ts';
import { useDragOrder } from './drag-order.ts';
import { cx, Field, loadFailed, toast } from './kit.tsx';
import {
  BLEND_MODES, chainWires, insertModule, KIND_LABELS, makeModule, moduleFromLibrary, type Reach,
} from './model.ts';
import { PlaysOn } from './groups-drawer.tsx';
import { ParamsPanel } from './params.tsx';
import type { Preview } from './preview.ts';
import type { Entry } from './shelf.tsx';
import { SideExpand, SideFold } from './side-panels.tsx';
import { SoftenRow } from './soften.tsx';
import type { Studio } from './studio-store.ts';

const STATE_TEXT: Record<string, string> = { ok: 'Running', off: 'Off', pending: 'Compiling…',
  compile: 'Compile error', runtime: 'Runtime error', hung: 'Hung' };
const INPUT_ONLY = 'input';
const MAX_MODULES = 8;
// How a source joins.
const GLYPHS: Record<string, string> = { over: '●', under: '○', add: '+', multiply: '×', max: '▴' };
type Props = { st: Studio; pv: Preview };

export function ChainPane({ st, pv }: Props) {
  const l = st.selected.value, m = st.module.value, fixed = m && standardTitle(m, st.data.library);
  return (
    <section class="pane pane-params" data-pane="params" aria-label="Layer settings">
      <div class="pane-head"><h2 class="pane-title"><SideFold st={st} panel="params" /></h2>
        <SideExpand st={st} panel="params" /></div>
      <div class="pane-body params-wrap">
        <Field label="Layer name">{(id) => <input type="text" id={id} class="layer-title-input" maxlength={80}
          spellcheck={false} value={l?.title ?? ''} disabled={!l} onInput={(e) => {
            const title = e.currentTarget.value;
            if (l) st.editLayer(l.id, () => ({ title }));
          }} onBlur={() => {
            if (l && !st.selected.peek()?.title.trim()) st.editLayer(l.id, () => ({ title: 'Layer' }));
          }} />}</Field>
        <PlaysOn st={st} />
        <div class="chain-host"><Chain st={st} pv={pv} /></div>
        <SoftenRow st={st} l={l} />
        <Field label="Module name" class="module-title-field">{(id) => <>{fixed !== undefined
          ? <span id={id} class="module-title-fixed" title="A library module keeps the library's name.">{fixed}</span>
          : <input type="text" id={id} class="module-title-input" maxlength={80} spellcheck={false}
            value={m?.title ?? ''} disabled={!m} onInput={(e) => {
              const title = e.currentTarget.value;
              if (l && m) st.editModule(l.id, m.id, () => ({ title }));
            }} />}<span class="kind-badge" data-kind={m?.kind ?? ''}>{m ? KIND_LABELS[m.kind] : ''}</span></>}</Field>
        <div class="params-host"><ParamsPanel st={st} /></div>
      </div>
    </section>);
}

function Chain({ st, pv }: Props) {
  const l = st.selected.value, mods = l?.modules || [], sel = st.module.value;
  const setMods = (fn: (mods: Module[]) => Module[]) => {
    if (l) st.editLayer(l.id, (x) => ({ modules: fn(x.modules.slice()) }));
  };

  /** A library module (or a blank), after the selected module (model.ts insertModule). */
  function add(entry: Entry) {
    const layer = st.selected.peek(), cur = st.module.peek();
    if (!layer || ('kind' in entry && entry.kind === 'preset')) return;
    if (layer.modules.length >= MAX_MODULES) {
      return toast(`A layer has at most ${MAX_MODULES} modules.`, { kind: 'warn' });
    }
    const m = 'blank' in entry ? makeModule({ kind: entry.kind }) : moduleFromLibrary(entry);
    setMods((list) => insertModule(list, m, cur?.id));
    st.pickModule(m.id);
  }
  function remove(m: Module) {
    if (mods.length <= 1 || !l) return;
    setMods((list) => list.filter((x) => x.id !== m.id));
    const step = st.step();
    toast(`Deleted “${m.title}”.`, { action: { label: 'Undo', onClick: () => {
      st.undoStep(step);
      st.pickModule(m.id);
    } } });
  }
  const move = (i: number, j: number) => setMods((list) => {
    if (j >= 0 && j < list.length) list.splice(j, 0, list.splice(i, 1)[0]);
    return list;
  });
  const shelf = () => import('./shelf.tsx').then(({ openShelf }) => openShelf({ mode: 'module',
    library: st.data.library, onPick: add, audition: { pv, layer: l || undefined, moduleId: sel?.id } }))
    .catch(loadFailed);
  const { first, joins, reaches } = chainWires(mods), at = sel ? mods.indexOf(sel) : -1;
  const listRef = useRef<HTMLOListElement>(null), order = useDragOrder(listRef, move);
  return (
    <section class="chain" aria-label="Module chain">
      <div class="chain-head"><h3 class="chain-title">Chain</h3>
        <button type="button" class="btn small chain-add wide-only"
          title="Add a warp, source or filter from the library" disabled={!l || mods.length >= MAX_MODULES}
          onClick={shelf}>+ Module</button></div>
      <p class="pane-hint" hidden={!!l}>Select a layer to see its modules.</p>
      <ol class="chain-list" aria-label="Modules, first to last" ref={listRef}>
        {l && mods.map((m, i) => <ModuleRow key={m.id} m={m} i={i} mods={mods} first={first} selected={i === at}
          std={standardTitle(m, st.data.library)} grip={order.grip(i)} drop={order.drop(i, mods.length)}
          dragging={order.dragging === i}
          join={joins[i]} reach={reaches.filter((r) => r.from <= i && i <= r.to)} lit={at}
          state={st.status.module(l.id, m)} pick={() => st.pickModule(m.id)} remove={() => remove(m)}
          move={(dir) => move(i, i + dir)} set={(patch) => st.editModule(l.id, m.id, () => patch)} />)}
      </ol>
    </section>);
}

type Grip = ReturnType<ReturnType<typeof useDragOrder>['grip']>;

function ModuleRow({ m, i, mods, first, selected, std, grip, drop, dragging, join, reach, lit, state, pick, remove,
  move, set }: { m: Module; i: number; mods: Module[]; first: number; selected: boolean; std?: string; grip: Grip;
  drop?: string; dragging: boolean; join: string; reach: Reach[]; lit: number; state: { kind: string;
  message?: string }; pick: () => void; remove: () => void; move: (dir: number) => void;
  set: (patch: Partial<Module>) => void }) {
  const title = std ?? (m.title || KIND_LABELS[m.kind]), filter = m.kind === 'filter';
  const icon = (text: string, label: string, disabled: boolean, onClick: () => void) => <button type="button"
    class="icon-btn wide-only" aria-label={label} title={label} disabled={disabled} onClick={onClick}>{text}</button>;
  // The row's select as a patch: a source's blend (or input only), a filter's input.
  const opts = filter ? [['', 'No input'], ...mods.slice(0, i).filter((s) => s.kind === 'source')
    .map((s) => [s.id, s.title || 'Source'])]
    : [['', i === first ? 'Over (first)' : 'Add (default)'], ...BLEND_MODES.map((b) => [b.value, b.label]),
      ['under', 'Under'], [INPUT_ONLY, 'Input only (hidden)']];
  const value = filter ? m.input || '' : m.as === 'input' ? INPUT_ONLY : m.blend || '';
  return (
    <li class={cx('chain-row', selected && 'selected', m.enabled === false && 'off', dragging && 'dragging')}
      data-kind={m.kind} data-join={join} data-status={state.kind} data-drop={drop}
      onClick={(e) => { if (e.target === e.currentTarget) pick(); }}>
      <span class="chain-joint" aria-hidden="true">{GLYPHS[join]}</span>
      {reach.map((r) => <span class={cx('reach', r.to === lit && 'lit')} aria-hidden="true" data-kind={r.kind}
        style={{ '--lane': r.lane }} data-part={i === r.from ? 'from' : i === r.to ? 'to' : 'via'} />)}
      <div class="chain-top"><span class="grip" title="Drag to reorder" aria-hidden="true" {...grip} />
        <span class="chain-kinds"><span class="kind-badge">{KIND_LABELS[m.kind]}</span>
          {std === undefined && <span class="custom-badge"
            title="Custom code: written by the AI or in the code editor, not a library module">Custom</span>}</span>
        <button type="button" class="chain-name" aria-current={selected} onClick={pick}
          title={`${title} — ${STATE_TEXT[state.kind] || state.kind}${state.message ? `: ${state.message}` : ''}`}>
          {title}</button>
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
