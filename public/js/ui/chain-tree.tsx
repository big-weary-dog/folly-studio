// A chain that holds composites (SPEC-library "Composites"), as the Settings pane draws it: each list of modules a
// chain of its own on its came, and a composite's sub-layers one step in under its row, which opens and closes them
// like a folder (shut, it says what it holds). A sub-layer of one source is that source's row: its blend is the
// sub-layer's, and its grip drags the sub-layer. Only a sub-layer of several sources (or none first, or one turned off)
// has a head, one line (a grip to drag it among its composite's, its name, how it combines, where it plays, on,
// delete), over its chain. The warps and filters attached to a module (SPEC-library "Attached modules") sit one step in
// under its row.
import type { ComponentChildren, JSX } from 'preact';

import type { Module, SubLayer } from '../../../shared/schemas/look.ts';
import { standardTitle } from '../../../shared/standard-modules.ts';
import { attachedTo, flatModules, runEnd } from '../core/tree.ts';
import { ModuleRow, type SubBlend } from './chain-row.tsx';
import { type Box, MAX_SUBLAYERS, removable } from './composite-model.ts';
import { Drawer, useDrawer } from './drawer.tsx';
import { GroupsTree } from './groups-drawer.tsx';
import { cx } from './kit.tsx';
import { chainWires } from './model.ts';
import type { Studio } from './studio-store.ts';
import { slotKey, type TreeDrag } from './tree-drag.ts';

/** What every list of the tree shares: the Studio, the drag, the selection and the edits, which take module ids. */
export type TreeCtx = {
  st: Studio, layerId: string, mods: Module[], drag: TreeDrag, sel: Module | null, settingsOpen: boolean,
  settings: () => JSX.Element, isOpen: (id: string) => boolean, toggle: (id: string) => void,
  click: (m: Module, e: MouseEvent) => void, remove: (m: Module) => void, nudge: (id: string, e: KeyboardEvent) => void,
  set: (id: string, patch: Partial<Module>) => void,
  editSub: (comp: string, k: number, p: Partial<SubLayer> | null) => void,
  moveSub: (comp: string, k: number, to: number) => void,
  addSub: (comp: string) => void,
};

/** Is sub-layer `s` its first module's: one source, first, the rest warps and filters, and on? */
export const isLone = (s: SubLayer) => s.enabled !== false && ['source', 'composite'].includes(s.modules[0]?.kind)
  && s.modules.slice(1).every((x) => x.kind === 'warp' || x.kind === 'filter');
/** Where sub-layer `s` plays, for a button: its groups', or the whole layer. */
const whereOf = (st: Studio, s: SubLayer) => (s.groups || s.tags?.length ? st.groupNames(s.groups, s.tags) : '');

const BLENDS: [string, string][] = [['', 'Default'], ['over', 'Over'], ['add', 'Add'], ['max', 'Max'],
  ['multiply', 'Multiply'], ['under', 'Under']];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** What a shut composite holds: "2 sub-layers · 4 modules". */
export const summary = (m: Module) => {
  const subs = m.layers ?? [], n = flatModules(subs.flatMap((s) => s.modules)).filter((x) => !x.layers).length;
  return `${plural(subs.length, 'sub-layer')} · ${plural(n, 'module')}`;
};

/** A sub-layer of one source, drawn as that source's row. */
type Lone = { comp: Module, s: SubLayer, k: number };

/** One list of modules: the layer's chain, or a sub-layer's; each attached run under its module's row. In a sub-layer
 * of one source (`lone`), that source's row stands for the sub-layer, and the list has no end slot (a source dropped
 * by the sub-layer becomes one of its own). */
export function ChainList({ ctx, mods, box, depth, lone }: { ctx: TreeCtx; mods: Module[]; box: Box; depth: number;
  lone?: Lone }) {
  const { drag } = ctx;
  return (
    <ol class={cx('chain-list', depth > 0 && 'sub-chain')} aria-label="Modules, first to last" data-depth={depth}>
      {mods.map((m, i) => {
        if (m.on && attachedTo(mods, i) === m.on) return null;
        const comp = m.kind === 'composite', open = comp && ctx.isOpen(m.id), src = comp || m.kind === 'source';
        return <Row key={m.id} ctx={ctx} mods={mods} i={i} box={box} lone={i === 0 ? lone : undefined}>
          {comp ? open && <CompositeBody ctx={ctx} m={m} depth={depth} /> : <Settings ctx={ctx} m={m} />}
          {src && <AttachList ctx={ctx} mods={mods} i={i} box={box} />}
        </Row>;
      })}
      {lone ? <li class="chain-end" aria-hidden="true" /> : <li class="chain-end" aria-hidden="true"
        data-slot={slotKey(box, mods.length)} data-drop={drag.marked(box, mods.length) ? 'before' : undefined} />}
    </ol>);
}

/** The selected module's settings under its row, on a wide screen with them open. */
const Settings = ({ ctx, m }: { ctx: TreeCtx; m: Module }) => (m === ctx.sel && ctx.settingsOpen
  && !ctx.st.narrow.value ? <div class="chain-params">{ctx.settings()}</div> : null);

/** Module i of `mods` as a row of the tree; `on`: the module it is attached to; `lone`: the sub-layer it stands for. */
function Row({ ctx, mods, i, box, on, lone, children }: { ctx: TreeCtx; mods: Module[]; i: number; box: Box;
  on?: string; lone?: Lone; children: ComponentChildren }) {
  const { st, sel, drag } = ctx, m = mods[i], comp = m.kind === 'composite', open = comp && ctx.isOpen(m.id);
  const { first, joins, reaches } = chainWires(mods), at = sel ? mods.indexOf(sel) : -1;
  const blendAs: SubBlend | undefined = lone && { value: lone.s.blend, first: lone.k === 0,
    set: (v) => ctx.editSub(lone.comp.id, lone.k, { blend: v as SubLayer['blend'] }) };
  const where = lone && whereOf(st, lone.s);
  return <ModuleRow m={m} i={i} mods={mods} first={first} selected={i === at} attached={!!on}
    std={comp ? undefined : standardTitle(m, st.data.library)} slot={slotKey(box, i, on)}
    subSlot={lone && `${lone.comp.id} ${lone.k}`} blendAs={blendAs}
    grip={drag.grip(m.id, m.kind === 'warp' || m.kind === 'filter')}
    drop={(lone ? drag.subMarked(lone.comp.id, lone.k) : drag.marked(box, i, on)) ? 'before' : undefined}
    dragging={drag.dragging === m.id} deletable={removable(ctx.mods, m.id)}
    join={on ? m.kind : joins[i]} reach={on ? [] : reaches.filter((r) => r.from <= i && i <= r.to)} lit={at}
    state={st.status.module(ctx.layerId, m)}
    pick={(e) => (comp ? (ctx.toggle(m.id), st.pickModule(m.id)) : ctx.click(m, e))}
    remove={() => ctx.remove(m)} nudge={(e) => ctx.nudge(m.id, e)} set={(p) => ctx.set(m.id, p)}
    fold={comp ? open : st.narrow.value || i !== at ? undefined : ctx.settingsOpen}
    note={comp && !open ? summary(m) : where ? `Plays on ${where}` : undefined}>{children}</ModuleRow>;
}

/** The warps and filters attached to module i, one step in, and a slot to attach one after them. */
function AttachList({ ctx, mods, i, box }: { ctx: TreeCtx; mods: Module[]; i: number; box: Box }) {
  const end = runEnd(mods, i), on = mods[i].id;
  return (
    <ol class="chain-list sub-chain attach-list" aria-label={`Attached to ${mods[i].title}`}>
      {mods.slice(i + 1, end).map((m, n) => <Row key={m.id} ctx={ctx} mods={mods} i={i + 1 + n} box={box} on={on}>
        <Settings ctx={ctx} m={m} /></Row>)}
      <li class="chain-end" aria-hidden="true" data-slot={slotKey(box, end, on)} data-attach
        data-drop={ctx.drag.marked(box, end, on) ? 'before' : undefined} />
    </ol>);
}

/** A composite's sub-layers, top to bottom in the order they combine, and a button to add one. */
function CompositeBody({ ctx, m, depth }: { ctx: TreeCtx; m: Module; depth: number }) {
  const layers = m.layers ?? [], { drag } = ctx;
  return (
    <div class="composite-body">
      {layers.map((s, k) => {
        const lone = isLone(s);
        return <div key={s.id} class={cx('sub-layer', s.enabled === false && 'off',
          drag.dragging === `${m.id} ${k}` && 'dragging')}>
          {!lone && <SubHead ctx={ctx} comp={m} s={s} k={k} />}
          <ChainList ctx={ctx} mods={s.modules} box={{ comp: m.id, sub: k }} depth={depth + 1}
            lone={lone ? { comp: m, s, k } : undefined} />
        </div>;
      })}
      <div class="sub-end" aria-hidden="true" data-sub-slot={`${m.id} ${layers.length}`}
        data-drop={drag.subMarked(m.id, layers.length) ? 'before' : undefined} />
      <button type="button" class="btn small sub-add" title="Add a source on top, a sub-layer of its own"
        onClick={() => ctx.addSub(m.id)} disabled={layers.length >= MAX_SUBLAYERS}>+ Source</button>
    </div>);
}

/** Where sub-layer `s` plays, a button opening the groups drawer; `icon`: ◎ when it plays on the whole layer. */
export function SubWhere({ st, s, edit, icon }: { st: Studio; s: SubLayer; edit: (p: Partial<SubLayer>) => void;
  icon?: boolean }) {
  const d = useDrawer(), where = whereOf(st, s);
  return <>
    <button type="button" class="btn small sub-where" title={`Where this sub-layer plays, within the layer: ${
      where || 'the whole layer'}`} aria-expanded={d.open} onClick={d.toggle}>{where || (icon ? '◎' : 'Whole layer')}
    </button>
    <Drawer d={d} title={`Groups · ${s.title}`} class="groups-drawer">
      <div class="tree-wrap"><GroupsTree st={st} groups={s.groups ?? []}
        set={(groups) => edit({ groups: groups.length ? groups : undefined, tags: undefined })} /></div></Drawer>
  </>;
}

/** A sub-layer's head, one line: a grip (or Alt+↑/↓) to reorder it, its name, how it combines onto those above it,
 * where it plays, on, delete. */
function SubHead({ ctx, comp, s, k }: { ctx: TreeCtx; comp: Module; s: SubLayer; k: number }) {
  const { st, drag } = ctx, edit = (p: Partial<SubLayer> | null) => ctx.editSub(comp.id, k, p);
  const n = comp.layers?.length ?? 0;
  const nudge = (e: KeyboardEvent) => {
    const to = k + (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0);
    if (!e.altKey || to === k || (e.target as Element).closest('select')) return;
    e.preventDefault();
    e.stopPropagation();
    if (to >= 0 && to < n) ctx.moveSub(comp.id, k, to > k ? to + 1 : to);
  };
  return (
    <div class="sub-head" onKeyDown={nudge} data-sub-slot={`${comp.id} ${k}`}
      data-drop={drag.subMarked(comp.id, k) ? 'before' : undefined}>
      <span class="grip" title="Drag to reorder the sub-layers (or Alt+↑/↓)" aria-hidden="true"
        {...drag.subGrip(comp.id, k)} />
      <input type="text" class="sub-name" aria-label="Sub-layer name" maxlength={80} spellcheck={false}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        value={s.title} onInput={(e) => edit({ title: e.currentTarget.value })} />
      <select class="chain-select wide-only" aria-label="Combine" title="How it combines onto the sub-layers above it"
        value={s.blend ?? ''}
        onChange={(e) => edit({ blend: (e.currentTarget.value || undefined) as SubLayer['blend'] })}>
        {BLENDS.map(([v, t]) => <option value={v}>{v ? t : k ? 'Add' : 'Over'}</option>)}</select>
      <SubWhere st={st} s={s} edit={edit} icon />
      <input type="checkbox" class="switch" aria-label={`${s.title} on`} checked={s.enabled !== false}
        onChange={(e) => {
          const on = e.currentTarget.checked;
          e.currentTarget.checked = !on;
          edit({ enabled: on ? undefined : false });
        }} />
      <button type="button" class="icon-btn wide-only" aria-label="Delete sub-layer" title="Delete sub-layer"
        disabled={n <= 1} onClick={() => edit(null)}>🗑</button>
    </div>);
}
