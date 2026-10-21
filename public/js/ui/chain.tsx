// The selected layer's settings: its name and groups (a drawer), its module chain (SPEC "Modules": a row per module
// with a grip to drag it (or Alt+↑/↓), its kind, Custom when it is not a library module, name, how a source combines
// or which input a filter reads, enable and delete; phones: drag, enable and select only), its Soften row, and the
// selected module's settings: a custom module's name (a library module keeps the library's) and its params, opened
// under its row (on a phone, after the chain). The chain runs down a came into the layer: each module joins it (a
// source by how it combines), and each warp and filter spans what it works on, everything above it.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { ComponentChildren } from 'preact';

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
  const l = st.selected.value, narrow = st.narrow.value;
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
        {narrow && <div class="params-host"><ModuleSettings st={st} /></div>}
      </div>
    </section>);
}

/** The selected module's settings: a custom module's name, then its params. */
function ModuleSettings({ st }: { st: Studio }) {
  const l = st.selected.value, m = st.module.value;
  return <>
    {l && m && standardTitle(m, st.data.library) === undefined && <Field label="Module name"
      class="module-title-field">{(id) => <input type="text" id={id} class="module-title-input" maxlength={80}
        spellcheck={false} value={m.title} onInput={(e) => {
          const title = e.currentTarget.value;
          st.editModule(l.id, m.id, () => ({ title }));
        }} />}</Field>}
    <ParamsPanel st={st} />
  </>;
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
  /** Alt+↑/↓ on a row's own buttons moves it, its name keeping the focus (a select keeps Alt+↓ to open). */
  const nudge = (i: number, e: KeyboardEvent) => {
    const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0, j = i + dir, at = e.target as Element;
    if (!e.altKey || !dir || !at.closest('.chain-top') || at.closest('select')) return;
    e.preventDefault();
    if (j < 0 || j >= mods.length) return;
    move(i, j);
    requestAnimationFrame(() => (listRef.current?.children[j]?.querySelector('.chain-name') as HTMLElement)?.focus());
  };
  const shelf = () => import('./shelf.tsx').then(({ openShelf }) => openShelf({ mode: 'module',
    library: st.data.library, onPick: add, audition: { pv, layer: l || undefined, moduleId: sel?.id } }))
    .catch(loadFailed);
  const { first, joins, reaches } = chainWires(mods), at = sel ? mods.indexOf(sel) : -1;
  const listRef = useRef<HTMLOListElement>(null), order = useDragOrder(listRef, move);
  // The selected module's settings open under it (a wide screen); a click on it closes them, until the next click
  // or pick.
  const [shut, setShut] = useState<{ layer: string; picked: object } | null>(null);
  const open = !st.narrow.value && !(shut && shut.layer === l?.id && shut.picked === st.picked.value);
  // The clicked row stays under the pointer while the settings above it close.
  const keep = useRef<{ i: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const k = keep.current, row = k && listRef.current?.children[k.i], pane = row?.closest('.pane-body');
    keep.current = null;
    if (row && pane) pane.scrollTop += row.getBoundingClientRect().top - k.top;
  });
  const click = (m: Module, i: number, e: MouseEvent) => {
    if (st.narrow.peek() && m === sel) return;      // no settings under rows to open or close
    keep.current = { i, top: (e.currentTarget as Element).closest('.chain-row')!.getBoundingClientRect().top };
    if (l && m === sel) setShut(open ? { layer: l.id, picked: st.picked.peek() } : null);
    else st.pickModule(m.id);
  };
  return (
    <section class="chain" aria-label="Module chain">
      <div class="chain-head"><h3 class="chain-title">Chain</h3>
        <button type="button" class="btn small chain-add wide-only" data-tour="chain-add"
          title="Add a warp, source or filter from the library" disabled={!l || mods.length >= MAX_MODULES}
          onClick={shelf}>+ Module</button></div>
      <p class="pane-hint" hidden={!!l}>Select a layer to see its modules.</p>
      <ol class="chain-list" aria-label="Modules, first to last" ref={listRef}>
        {l && mods.map((m, i) => <ModuleRow key={m.id} m={m} i={i} mods={mods} first={first} selected={i === at}
          std={standardTitle(m, st.data.library)} grip={order.grip(i)} drop={order.drop(i, mods.length)}
          dragging={order.dragging === i}
          join={joins[i]} reach={reaches.filter((r) => r.from <= i && i <= r.to)} lit={at}
          state={st.status.module(l.id, m)} pick={(e) => click(m, i, e)} remove={() => remove(m)}
          nudge={(e) => nudge(i, e)} set={(patch) => st.editModule(l.id, m.id, () => patch)}
          fold={st.narrow.value || i !== at ? undefined : open}>
          {i === at && open && <div class="chain-params"><ModuleSettings st={st} /></div>}</ModuleRow>)}
      </ol>
    </section>);
}

type Grip = ReturnType<ReturnType<typeof useDragOrder>['grip']>;

/** A module's row; `fold`: whether the selected module's settings show under it (wide screens), and its children. */
function ModuleRow({ m, i, mods, first, selected, std, grip, drop, dragging, join, reach, lit, state, pick, remove,
  nudge, set, fold, children }: { m: Module; i: number; mods: Module[]; first: number; selected: boolean; std?: string;
  grip: Grip; drop?: string; dragging: boolean; join: string; reach: Reach[]; lit: number; state: { kind: string;
  message?: string }; pick: (e: MouseEvent) => void; remove: () => void; nudge: (e: KeyboardEvent) => void;
  set: (patch: Partial<Module>) => void; fold?: boolean; children?: ComponentChildren }) {
  const title = std ?? (m.title || KIND_LABELS[m.kind]), filter = m.kind === 'filter';
  // The row's select as a patch: a source's blend (or input only), a filter's input. A source's default ('') is
  // Over first and Add after, so that blend is not offered twice.
  const dflt = i === first ? 'over' : 'add';
  const opts = filter ? [['', 'No input'], ...mods.slice(0, i).filter((s) => s.kind === 'source')
    .map((s) => [s.id, s.title || 'Source'])]
    : [['', dflt === 'over' ? 'Over' : 'Add'], ...BLEND_MODES.filter((b) => b.value !== dflt)
      .map((b) => [b.value, b.label]), ['under', 'Under'], [INPUT_ONLY, 'Input only']];
  const value = filter ? m.input || '' : m.as === 'input' ? INPUT_ONLY : m.blend === dflt ? '' : m.blend || '';
  const how = filter ? 'Input' : 'Combine';
  return (
    <li class={cx('chain-row', selected && 'selected', m.enabled === false && 'off', dragging && 'dragging')}
      data-kind={m.kind} data-join={join} data-status={state.kind} data-drop={drop} onKeyDown={nudge}
      onClick={(e) => { if (e.target === e.currentTarget && !selected) pick(e); }}>
      <span class="chain-joint" aria-hidden="true">{GLYPHS[join]}</span>
      {reach.map((r) => <span class={cx('reach', r.to === lit && 'lit')} aria-hidden="true" data-kind={r.kind}
        style={{ '--lane': r.lane }} data-part={i === r.from ? 'from' : i === r.to ? 'to' : 'via'} />)}
      <div class="chain-top"><span class="grip" title="Drag to reorder (or Alt+↑/↓)" aria-hidden="true" {...grip} />
        <span class="chain-kinds"><span class="kind-badge">{KIND_LABELS[m.kind]}</span>
          {std === undefined && <span class="custom-badge"
            title="Custom code: written by the AI or in the code editor, not a library module">Custom</span>}</span>
        <button type="button" class="chain-name" aria-current={selected} aria-expanded={fold} onClick={pick}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" data-tour={m.ref && `module:${m.ref}`}
          title={`${title} — ${STATE_TEXT[state.kind] || state.kind}${state.message ? `: ${state.message}` : ''}`}>
          {title}</button>
        {m.kind !== 'warp' && <select class="chain-select wide-only" aria-label={how} title={how}
          value={opts.some(([v]) => v === value) ? value : ''} onChange={(e) => {
            const v = e.currentTarget.value;
            set(filter ? { input: v || undefined } : v === INPUT_ONLY ? { as: 'input', blend: undefined }
              : { as: undefined, blend: (v || undefined) as Module['blend'] });
          }}>{opts.map(([v, t]) => <option value={v}>{t}</option>)}</select>}
        <input type="checkbox" class="switch chain-on" aria-label={`${title} on`} checked={m.enabled !== false}
          data-tour={m.ref && `module-on:${m.ref}`}
          onChange={(e) => {
            const on = e.currentTarget.checked;
            e.currentTarget.checked = !on;      // the look decides
            set({ enabled: on ? undefined : false });
          }} />
        <button type="button" class="icon-btn wide-only" aria-label="Delete module" title="Delete module"
          disabled={mods.length <= 1} onClick={remove}>🗑</button></div>
      {children}
    </li>);
}
