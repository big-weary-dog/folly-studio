// A chain that holds composites (SPEC-library "Composites"), as the Settings pane draws it: each list of modules a
// chain of its own on its came, and a composite's sub-layers nested under its row, which opens and closes them like a
// folder (shut, it says what it holds). Each sub-layer has a head (a grip to drag it among its composite's, its name,
// how it combines, where it plays, on, delete) over its chain.
import type { JSX } from 'preact';

import type { Module, SubLayer } from '../../../shared/schemas/look.ts';
import { standardTitle } from '../../../shared/standard-modules.ts';
import { flatModules } from '../core/tree.ts';
import { ModuleRow } from './chain-row.tsx';
import type { Box } from './composite-model.ts';
import { Drawer, useDrawer } from './drawer.tsx';
import { GroupsTree } from './groups-drawer.tsx';
import { cx } from './kit.tsx';
import { chainWires } from './model.ts';
import type { Studio } from './studio-store.ts';
import { slotKey, type TreeDrag } from './tree-drag.ts';

/** What every list of the tree shares: the Studio, the drag, the selection and the edits, which take module ids. */
export type TreeCtx = {
  st: Studio, layerId: string, drag: TreeDrag, sel: Module | null, settingsOpen: boolean,
  settings: () => JSX.Element, isOpen: (id: string) => boolean, toggle: (id: string) => void,
  click: (m: Module, e: MouseEvent) => void, remove: (m: Module) => void, nudge: (id: string, e: KeyboardEvent) => void,
  set: (id: string, patch: Partial<Module>) => void,
  editSub: (comp: string, k: number, p: Partial<SubLayer> | null) => void,
  moveSub: (comp: string, k: number, to: number) => void,
  addSub: (comp: string) => void,
};

const BLENDS: [string, string][] = [['', 'Default'], ['over', 'Over'], ['add', 'Add'], ['max', 'Max'],
  ['multiply', 'Multiply'], ['under', 'Under']];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** What a shut composite holds: "2 sub-layers · 4 modules". */
export const summary = (m: Module) => {
  const subs = m.layers ?? [], n = flatModules(subs.flatMap((s) => s.modules)).filter((x) => !x.layers).length;
  return `${plural(subs.length, 'sub-layer')} · ${plural(n, 'module')}`;
};

/** One list of modules: the layer's chain, or a sub-layer's. */
export function ChainList({ ctx, mods, box, depth }: { ctx: TreeCtx; mods: Module[]; box: Box; depth: number }) {
  const { st, sel, drag } = ctx, { first, joins, reaches } = chainWires(mods), at = sel ? mods.indexOf(sel) : -1;
  return (
    <ol class={cx('chain-list', depth > 0 && 'sub-chain')} aria-label="Modules, first to last" data-depth={depth}
      data-tour={depth ? undefined : 'chain'}>
      {mods.map((m, i) => {
        const comp = m.kind === 'composite', open = comp && ctx.isOpen(m.id);
        return <ModuleRow key={m.id} m={m} i={i} mods={mods} first={first} selected={i === at}
          std={comp ? undefined : standardTitle(m, st.data.library)} grip={drag.grip(m.id)} slot={slotKey(box, i)}
          drop={drag.marked(box, i) ? 'before' : undefined} dragging={drag.dragging === m.id} join={joins[i]}
          reach={reaches.filter((r) => r.from <= i && i <= r.to)} lit={at} state={st.status.module(ctx.layerId, m)}
          pick={(e) => (comp ? (ctx.toggle(m.id), st.pickModule(m.id)) : ctx.click(m, e))}
          remove={() => ctx.remove(m)} nudge={(e) => ctx.nudge(m.id, e)} set={(p) => ctx.set(m.id, p)}
          fold={comp ? open : st.narrow.value || i !== at ? undefined : ctx.settingsOpen}
          note={comp && !open ? summary(m) : undefined}>
          {comp ? open && <CompositeBody ctx={ctx} m={m} depth={depth} />
            : i === at && ctx.settingsOpen && !st.narrow.value && <div class="chain-params">{ctx.settings()}</div>}
        </ModuleRow>;
      })}
      <li class="chain-end" aria-hidden="true" data-slot={slotKey(box, mods.length)}
        data-drop={drag.marked(box, mods.length) ? 'before' : undefined} />
    </ol>);
}

/** A composite's name, then its sub-layers, top to bottom in the order they combine, and a button to add one. */
function CompositeBody({ ctx, m, depth }: { ctx: TreeCtx; m: Module; depth: number }) {
  const layers = m.layers ?? [], { drag } = ctx;
  return (
    <div class="composite-body">
      <input type="text" class="sub-name comp-name" aria-label="Composite name" maxlength={80} spellcheck={false}
        placeholder="Composite" value={m.title} onInput={(e) => ctx.set(m.id, { title: e.currentTarget.value })} />
      {layers.map((s, k) => <div key={s.id} class={cx('sub-layer', s.enabled === false && 'off',
        drag.dragging === `${m.id} ${k}` && 'dragging')} data-sub-slot={`${m.id} ${k}`}
        data-drop={drag.subMarked(m.id, k) ? 'before' : undefined}>
        <SubHead ctx={ctx} comp={m} s={s} k={k} />
        <ChainList ctx={ctx} mods={s.modules} box={{ comp: m.id, sub: k }} depth={depth + 1} />
      </div>)}
      <div class="sub-end" aria-hidden="true" data-sub-slot={`${m.id} ${layers.length}`}
        data-drop={drag.subMarked(m.id, layers.length) ? 'before' : undefined} />
      <button type="button" class="btn small sub-add" title="Add a sub-layer: pick its first module"
        onClick={() => ctx.addSub(m.id)} disabled={layers.length >= 4}>+ Sub-layer</button>
    </div>);
}

/** A sub-layer's head: a grip (or Alt+↑/↓) to reorder it, its name, how it combines onto those above it, where it
 * plays, on, delete. */
function SubHead({ ctx, comp, s, k }: { ctx: TreeCtx; comp: Module; s: SubLayer; k: number }) {
  const d = useDrawer(), { st } = ctx, edit = (p: Partial<SubLayer> | null) => ctx.editSub(comp.id, k, p);
  const where = s.groups || s.tags?.length ? st.groupNames(s.groups, s.tags) : 'Whole layer';
  const n = comp.layers?.length ?? 0;
  const nudge = (e: KeyboardEvent) => {
    const to = k + (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0);
    if (!e.altKey || to === k || (e.target as Element).closest('select')) return;
    e.preventDefault();
    e.stopPropagation();
    if (to >= 0 && to < n) ctx.moveSub(comp.id, k, to > k ? to + 1 : to);
  };
  return (
    <div class="sub-head" onKeyDown={nudge}>
      <span class="grip" title="Drag to reorder the sub-layers (or Alt+↑/↓)" aria-hidden="true"
        {...ctx.drag.subGrip(comp.id, k)} />
      <span class="kind-badge sub-badge">Sub {k + 1}</span>
      <input type="text" class="sub-name" aria-label="Sub-layer name" maxlength={80} spellcheck={false}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
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
        disabled={n <= 1} onClick={() => edit(null)}>🗑</button>
      <Drawer d={d} title={`Groups · ${s.title}`} class="groups-drawer">
        <div class="tree-wrap"><GroupsTree st={st} groups={s.groups ?? []}
          set={(groups) => edit({ groups: groups.length ? groups : undefined, tags: undefined })} /></div></Drawer>
    </div>);
}
