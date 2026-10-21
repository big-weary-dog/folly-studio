// The selected layer's settings: its name and groups (a drawer), its module chain (SPEC "Modules": a row per module
// with a grip to drag it (or Alt+↑/↓), its kind, Custom when it is not a library module, name, how a source combines
// or which input a filter reads, enable and delete; phones: drag, enable and select only), its Soften row, and the
// selected module's settings: a custom module's name (a library module keeps the library's) and its params, opened
// under its row (on a phone, after the chain). The chain runs down a came into the layer: each module joins it (a
// source by how it combines), and each warp and filter spans what it works on, everything above it.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { Module } from '../../../shared/schemas/look.ts';
import { standardTitle } from '../../../shared/standard-modules.ts';
import { Field, loadFailed, toast } from './kit.tsx';
import { insertModule, makeModule, moduleFromLibrary } from './model.ts';
import { ChainList, CompositeBody, type TreeCtx, type Variant } from './chain-tree.tsx';
import { addSub, type Box, editSub, groupModule, listOf, moveModule, placeOf, ungroup, withList }
  from './composite-model.ts';
import { flatModules } from '../core/tree.ts';
import { parseSlot, useTreeDrag } from './tree-drag.ts';
import { PlaysOn } from './groups-drawer.tsx';
import { ParamsPanel } from './params.tsx';
import type { Preview } from './preview.ts';
import type { Entry } from './shelf.tsx';
import { SideExpand, SideFold } from './side-panels.tsx';
import { SoftenRow } from './soften.tsx';
import type { Studio } from './studio-store.ts';

const MAX_MODULES = 8;
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

const VARIANT = ((typeof location === 'object' && new URLSearchParams(location.search).get('cux')) || 'a') as Variant;
const KEEP_ONE = 'A list keeps at least one module, and a composite cannot go inside itself.';

function Chain({ st, pv }: Props) {
  const l = st.selected.value, mods = l?.modules || [], sel = st.module.value;
  /** An edit of the chain; fn says null when it is not one (`why` then says so). */
  const setMods = (fn: (mods: Module[]) => Module[] | null, why?: string) => {
    const next = l && fn(l.modules);
    if (next && next !== l.modules) st.editLayer(l.id, () => ({ modules: next }));
    else if (l && why) toast(why, { kind: 'warn' });
  };
  /** Where the selected module sits (the layer's chain's end when none is). */
  const here = () => (sel && placeOf(mods, sel.id)) || { box: null, index: mods.length - 1 };

  /** A library module (or a blank), after the selected module in its list (model.ts insertModule). */
  function add(entry: Entry) {
    const layer = st.selected.peek(), cur = st.module.peek(), { box } = here();
    if (!layer || ('kind' in entry && entry.kind === 'preset')) return;
    if (listOf(mods, box).length >= MAX_MODULES) {
      return toast(`A chain has at most ${MAX_MODULES} modules.`, { kind: 'warn' });
    }
    const m = 'blank' in entry ? makeModule({ kind: entry.kind }) : moduleFromLibrary(entry);
    setMods((list) => withList(list, box, (x) => insertModule(x, m, cur?.id)));
    st.pickModule(m.id);
  }
  function remove(m: Module) {
    const at = placeOf(mods, m.id);
    if (!at || listOf(mods, at.box).length <= 1 || !l) return;
    setMods((list) => withList(list, at.box, (x) => x.filter((y) => y.id !== m.id)));
    const step = st.step();
    toast(`Deleted “${m.title}”.`, { action: { label: 'Undo', onClick: () => {
      st.undoStep(step);
      st.pickModule(m.id);
    } } });
  }
  const move = (id: string, box: Box, i: number) => setMods((list) => moveModule(list, id, box, i), KEEP_ONE);
  const rootRef = useRef<HTMLDivElement>(null), drag = useTreeDrag(rootRef, move);
  const rowOf = (id: string) => rootRef.current?.querySelector<HTMLElement>(`.chain-row[data-module="${id}"]`);
  /** Alt+↑/↓ on a row's own buttons moves it a slot, into and out of composites, its name keeping the focus. */
  const nudge = (id: string, e: KeyboardEvent) => {
    const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0, at = e.target as Element, row = rowOf(id);
    if (!e.altKey || !dir || !at.closest('.chain-top') || at.closest('select') || !row) return;
    e.preventDefault();
    e.stopPropagation();
    const own = row.querySelector(':scope > .chain-top');
    const slots = [...rootRef.current!.querySelectorAll<HTMLElement>('[data-slot]')]
      .filter((s) => s === own || !row.contains(s));
    const to = slots[slots.indexOf(own as HTMLElement) + (dir < 0 ? -1 : 2)]?.dataset.slot;
    if (!to) return;
    move(id, ...parseSlot(to));
    requestAnimationFrame(() => (rowOf(id)?.querySelector('.chain-name') as HTMLElement)?.focus());
  };
  const shelf = (onPick: (e: Entry) => void) => import('./shelf.tsx').then(({ openShelf }) => openShelf({
    mode: 'module', library: st.data.library, onPick, audition: { pv, layer: l || undefined, moduleId: sel?.id } }))
    .catch(loadFailed);
  // The selected module's settings open under it (a wide screen); a click on it closes them, until the next click
  // or pick.
  const [shut, setShut] = useState<{ layer: string; picked: object } | null>(null);
  const open = !st.narrow.value && !(shut && shut.layer === l?.id && shut.picked === st.picked.value);
  // Composites shut (a, c: their sub-layers out of sight; b: the one opened), each one's tab.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Record<string, number>>({});
  // The clicked row stays under the pointer while the settings above it close.
  const keep = useRef<{ id: string; top: number } | null>(null);
  useLayoutEffect(() => {
    const k = keep.current, row = k && rowOf(k.id), pane = row?.closest('.pane-body');
    keep.current = null;
    if (row && pane) pane.scrollTop += row.getBoundingClientRect().top - k.top;
  });
  const click = (m: Module, e: MouseEvent) => {
    if (st.narrow.peek() && m === sel) return;      // no settings under rows to open or close
    keep.current = { id: m.id, top: (e.currentTarget as Element).closest('.chain-row')!.getBoundingClientRect().top };
    if (l && m === sel) setShut(open ? { layer: l.id, picked: st.picked.peek() } : null);
    else st.pickModule(m.id);
  };
  const ctx: TreeCtx = { st, layerId: l?.id ?? '', variant: VARIANT, drag, sel, settingsOpen: open,
    settings: () => <ModuleSettings st={st} />, click, remove, nudge,
    isOpen: (id) => !closed.has(id),
    toggle: (id) => {
      if (VARIANT === 'b') return setOpened(id);
      const next = new Set(closed);
      if (!next.delete(id)) next.add(id);
      setClosed(next);
    },
    tab: (id) => tabs[id] ?? 0, setTab: (id, k) => setTabs({ ...tabs, [id]: k }),
    set: (id, patch) => l && st.editModule(l.id, id, () => patch),
    editSub: (comp, k, p) => setMods((list) => editSub(list, comp, k, p)),
    addSub: (comp) => void shelf((entry) => {
      if ('kind' in entry && entry.kind === 'preset') return;
      const m = 'blank' in entry ? makeModule({ kind: entry.kind }) : moduleFromLibrary(entry);
      setMods((list) => addSub(list, comp, m));
      setTabs({ ...tabs, [comp]: (flatModules(mods).find((x) => x.id === comp)?.layers?.length ?? 0) });
      st.pickModule(m.id);
    }),
  };
  const inside = VARIANT === 'b' && opened ? flatModules(mods).find((m) => m.id === opened && m.layers) : undefined;
  const group = () => sel && setMods((list) => groupModule(list, sel.id));
  const single = sel?.kind === 'composite' && sel.layers?.length === 1;
  return (
    <section class="chain" aria-label="Module chain" ref={rootRef}>
      <div class="chain-head"><h3 class="chain-title">Chain</h3>
        <span class="chain-acts">
          <button type="button" class="btn small chain-group wide-only" disabled={!sel}
            title={single ? 'Put the composite\'s modules back in its place'
              : 'Put the selected module in a composite: '
              + 'sub-layers composited into one source, which the modules below it work on'}
            onClick={() => (single ? setMods((list) => ungroup(list, sel.id)) : group())}>
            {single ? 'Ungroup' : '⧉ Composite'}</button>
          <button type="button" class="btn small chain-add wide-only" data-tour="chain-add"
            title="Add a warp, source or filter from the library, after the selected module"
            disabled={!l} onClick={() => shelf(add)}>+ Module</button></span></div>
      <p class="pane-hint" hidden={!!l}>Select a layer to see its modules.</p>
      {inside && <nav class="chain-crumbs" aria-label="Where you are">
        <button type="button" class="btn small" onClick={() => setOpened(null)}>‹ Chain</button>
        <span class="crumb">{l?.title} › <b>{inside.title}</b></span></nav>}
      {l && (inside ? <CompositeBody ctx={ctx} m={inside} depth={0} />
        : <ChainList ctx={ctx} mods={mods} box={null} depth={0} />)}
    </section>);
}
