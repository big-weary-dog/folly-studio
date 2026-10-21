// A chain that holds composites (SPEC-library "Composites"), as the Settings pane draws it: each list of modules a
// chain of its own on its came, and a composite's sub-layers under its row, each with a head (its name, how it
// combines, where it plays, on, delete) over its chain. Three ways to show them, for the proposal (?cux=):
// a: nested in place, a composite opening and closing like a folder; b: opened on its own, a breadcrumb back;
// c: one sub-layer at a time, behind tabs.
import type { JSX } from 'preact';

import type { Module, SubLayer } from '../../../shared/schemas/look.ts';
import { standardTitle } from '../../../shared/standard-modules.ts';
import { ModuleRow } from './chain-row.tsx';
import type { Box } from './composite-model.ts';
import { Drawer, useDrawer } from './drawer.tsx';
import { GroupsTree } from './groups-drawer.tsx';
import { cx } from './kit.tsx';
import { chainWires } from './model.ts';
import type { Studio } from './studio-store.ts';
import { slotKey, type TreeDrag } from './tree-drag.ts';

export type Variant = 'a' | 'b' | 'c';
/** What every list of the tree shares: the Studio, the drag, the selection and the edits, which take module ids. */
export type TreeCtx = {
  st: Studio, layerId: string, variant: Variant, drag: TreeDrag, sel: Module | null, settingsOpen: boolean,
  settings: () => JSX.Element, isOpen: (id: string) => boolean, toggle: (id: string) => void,
  tab: (id: string) => number, setTab: (id: string, k: number) => void,
  click: (m: Module, e: MouseEvent) => void, remove: (m: Module) => void, nudge: (id: string, e: KeyboardEvent) => void,
  set: (id: string, patch: Partial<Module>) => void,
  editSub: (comp: string, k: number, p: Partial<SubLayer> | null) => void,
  addSub: (comp: string) => void,
};

const BLENDS: [string, string][] = [['', 'Default'], ['over', 'Over'], ['add', 'Add'], ['max', 'Max'],
  ['multiply', 'Multiply'], ['under', 'Under']];
/** A composite's line when its sub-layers are out of sight: how many, and their names. */
const summary = (m: Module) => {
  const n = m.layers?.length ?? 0;
  return `${n} sub-layer${n === 1 ? '' : 's'}: ${(m.layers ?? []).map((s) => s.title).join(', ')}`;
};

/** One list of modules: the layer's chain, or a sub-layer's. */
export function ChainList({ ctx, mods, box, depth }: { ctx: TreeCtx; mods: Module[]; box: Box; depth: number }) {
  const { st, sel, drag } = ctx, { first, joins, reaches } = chainWires(mods), at = sel ? mods.indexOf(sel) : -1;
  return (
    <ol class={cx('chain-list', depth > 0 && 'sub-chain')} aria-label="Modules, first to last" data-depth={depth}>
      {mods.map((m, i) => {
        const comp = m.kind === 'composite', inline = comp && ctx.variant !== 'b', open = inline && ctx.isOpen(m.id);
        return <ModuleRow key={m.id} m={m} i={i} mods={mods} first={first} selected={i === at}
          std={comp ? undefined : standardTitle(m, st.data.library)} grip={drag.grip(m.id)} slot={slotKey(box, i)}
          drop={drag.marked(box, i) ? 'before' : undefined} dragging={drag.dragging === m.id} join={joins[i]}
          reach={reaches.filter((r) => r.from <= i && i <= r.to)} lit={at} state={st.status.module(ctx.layerId, m)}
          pick={(e) => (comp ? (ctx.variant === 'b' ? ctx.toggle(m.id) : (ctx.toggle(m.id), st.pickModule(m.id)))
            : ctx.click(m, e))}
          remove={() => ctx.remove(m)} nudge={(e) => ctx.nudge(m.id, e)} set={(p) => ctx.set(m.id, p)}
          fold={comp ? (inline ? open : undefined) : st.narrow.value || i !== at ? undefined : ctx.settingsOpen}
          note={comp && !open ? summary(m) : undefined}>
          {comp ? open && <CompositeBody ctx={ctx} m={m} depth={depth} />
            : i === at && ctx.settingsOpen && !st.narrow.value && <div class="chain-params">{ctx.settings()}</div>}
        </ModuleRow>;
      })}
      <li class="chain-end" aria-hidden="true" data-slot={slotKey(box, mods.length)}
        data-drop={drag.marked(box, mods.length) ? 'before' : undefined} />
    </ol>);
}

/** A composite's sub-layers, top to bottom in the order they combine, and a button to add one. */
export function CompositeBody({ ctx, m, depth }: { ctx: TreeCtx; m: Module; depth: number }) {
  const layers = m.layers ?? [], tabs = ctx.variant === 'c', k0 = Math.min(ctx.tab(m.id), layers.length - 1);
  const add = <button type="button" class="btn small sub-add" title="Add a sub-layer: pick its first module"
    onClick={() => ctx.addSub(m.id)} disabled={layers.length >= 4}>+ Sub-layer</button>;
  return (
    <div class="composite-body" data-variant={ctx.variant}>
      {tabs && <div class="sub-tabs" role="tablist">{layers.map((s, k) => <button type="button" role="tab"
        class={cx('sub-tab', k === k0 && 'on', s.enabled === false && 'off')} aria-selected={k === k0}
        onClick={() => ctx.setTab(m.id, k)}>{s.title}</button>)}{add}</div>}
      {layers.map((s, k) => (!tabs || k === k0) && <div class={cx('sub-layer', s.enabled === false && 'off')}
        key={s.id}>
        <SubHead ctx={ctx} comp={m} s={s} k={k} />
        <ChainList ctx={ctx} mods={s.modules} box={{ comp: m.id, sub: k }} depth={depth + 1} />
      </div>)}
      {!tabs && add}
    </div>);
}

/** A sub-layer's head: its name, how it combines onto those above it, where it plays, on, delete. */
function SubHead({ ctx, comp, s, k }: { ctx: TreeCtx; comp: Module; s: SubLayer; k: number }) {
  const d = useDrawer(), { st } = ctx, edit = (p: Partial<SubLayer> | null) => ctx.editSub(comp.id, k, p);
  const where = s.groups || s.tags?.length ? st.groupNames(s.groups, s.tags) : 'Whole layer';
  return (
    <div class="sub-head">
      <span class="kind-badge sub-badge">Sub {k + 1}</span>
      <input type="text" class="sub-name" aria-label="Sub-layer name" maxlength={80} spellcheck={false}
        value={s.title} onInput={(e) => edit({ title: e.currentTarget.value })} />
      <select class="chain-select" aria-label="Combine" title="How it combines onto the sub-layers above it"
        value={s.blend ?? ''}
        onChange={(e) => edit({ blend: (e.currentTarget.value || undefined) as SubLayer['blend'] })}>
        {BLENDS.map(([v, t]) => <option value={v}>{v ? t : k ? 'Add' : 'Over'}</option>)}</select>
      <button type="button" class="btn small sub-where" title="Where this sub-layer plays, within the layer"
        aria-expanded={d.open} onClick={d.toggle}>{where}</button>
      <input type="checkbox" class="switch" aria-label={`${s.title} on`} checked={s.enabled !== false}
        onChange={(e) => {
          const on = e.currentTarget.checked;
          e.currentTarget.checked = !on;
          edit({ enabled: on ? undefined : false });
        }} />
      <button type="button" class="icon-btn" aria-label="Delete sub-layer" title="Delete sub-layer"
        disabled={(comp.layers?.length ?? 0) <= 1} onClick={() => edit(null)}>🗑</button>
      <Drawer d={d} title={`Groups · ${s.title}`} class="groups-drawer">
        <div class="tree-wrap"><GroupsTree st={st} groups={s.groups ?? []}
          set={(groups) => edit({ groups: groups.length ? groups : undefined, tags: undefined })} /></div></Drawer>
    </div>);
}
