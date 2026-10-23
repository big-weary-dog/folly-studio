// A module's row in a chain (chain.tsx): its joint on the came and the reaches crossing it, a grip to drag it, its
// kind, Custom when it is not a library module, name, how a source (or composite) combines or which input a filter
// reads, enable and delete; a composite (marked ⧉) has a ▸ that opens and closes its sub-layers (chain-tree.tsx), its
// children, and its name renamed in place.
import type { ComponentChildren } from 'preact';

import type { Module } from '../../../shared/schemas/look.ts';
import { cx } from './kit.tsx';
import { flatModules } from '../core/tree.ts';
import { removalBlock } from './composite-model.ts';
import { BLEND_MODES, KIND_LABELS, type Reach } from './model.ts';
import type { TreeDrag } from './tree-drag.ts';

export const STATE_TEXT: Record<string, string> = { ok: 'Running', off: 'Off', pending: 'Compiling…',
  compile: 'Compile error', runtime: 'Runtime error', hung: 'Hung' };
const INPUT_ONLY = 'input';
// How a source joins.
const GLYPHS: Record<string, string> = { over: '●', under: '○', add: '+', multiply: '×', max: '▴' };
/** A composite's name longer than this has its row's line, its controls under it. */
const LONG = 16;
const isSource = (m: Module) => m.kind === 'source' || m.kind === 'composite';
export const removalTitle = (title: string, count: number) => `“${title}”${count
  ? ` and ${count} attached or contained module${count === 1 ? '' : 's'}` : ''}`;

type Grip = ReturnType<TreeDrag['grip']>;

/** How a source that is a composite's sub-layer combines: the sub-layer's blend, `first` the composite's first. */
export type SubBlend = { value?: string; first: boolean; set: (v?: string) => void };

/** A module's row; `slot`: its drop slot's key (`subSlot`: a sub-layer's, in its place); `fold`: whether what is
 * under it shows (the selected module's settings on wide screens, a composite's sub-layers), its children; `note`:
 * a line under its name; `blendAs`: its sub-layer's blend in place of its own. */
export function ModuleRow({ m, i, mods, first, selected, attached, std, grip, slot, subSlot, drop, dragging, join,
  reach, lit, state, pick, remove, deletable, nudge, set, fold, note, blendAs, children }: { m: Module; i: number;
  mods: Module[]; first: number; selected: boolean; attached?: boolean; std?: string; grip: Grip; slot: string;
  subSlot?: string; drop?: string; dragging: boolean; join: string; reach: Reach[]; lit: number;
  state: { kind: string; message?: string }; pick: (e: MouseEvent) => void; remove: () => void; deletable: boolean;
  nudge: (e: KeyboardEvent) => void; set: (patch: Partial<Module>) => void; fold?: boolean; note?: string;
  blendAs?: SubBlend; children?: ComponentChildren }) {
  const title = std ?? (m.title || KIND_LABELS[m.kind]), filter = m.kind === 'filter', comp = m.kind === 'composite';
  const count = flatModules(removalBlock(mods, i)).length - 1;
  const deletion = `Delete ${removalTitle(title, count)}`;
  // The row's select as a patch: a source's blend (or input only), a filter's input. A source's default ('') is
  // Over first and Add after, so that blend is not offered twice.
  const dflt = (blendAs ? blendAs.first : i === first) ? 'over' : 'add';
  const opts = filter ? [['', 'No input'], ...mods.slice(0, i).filter(isSource)
    .map((s) => [s.id, s.title || 'Source'])]
    : [['', dflt === 'over' ? 'Over' : 'Add'], ...BLEND_MODES.filter((b) => b.value !== dflt)
      .map((b) => [b.value, b.label]), ['under', 'Under'], ...(blendAs ? [] : [[INPUT_ONLY, 'Input only']])];
  const own = blendAs ? blendAs.value : m.as === 'input' ? INPUT_ONLY : m.blend;
  const value = filter ? m.input || '' : own === dflt ? '' : own || '';
  const how = filter ? 'Input' : 'Combine';
  return (
    <li class={cx('chain-row', selected && 'selected', m.enabled === false && 'off', dragging && 'dragging')}
      data-kind={m.kind} data-module={m.id} data-join={join} data-status={state.kind}
      data-drop={drop} data-tour-area onKeyDown={nudge}
      onClick={(e) => { if (e.target === e.currentTarget && !selected) pick(e); }}>
      <span class="chain-joint" aria-hidden="true">{GLYPHS[join]}</span>
      {reach.map((r) => <span class={cx('reach', r.to === lit && 'lit')} aria-hidden="true" data-kind={r.kind}
        style={{ '--lane': r.lane }} data-part={i === r.from ? 'from' : i === r.to ? 'to' : 'via'} />)}
      <div class="chain-top" data-slot={subSlot ? undefined : slot} data-sub-slot={subSlot}
        data-attach={attached || undefined}>
        <span class="grip" title={m.kind === 'warp' || m.kind === 'filter'
          ? 'Drag to reorder, onto a module (it then works on that module alone) or off it, into or out of a '
            + 'composite (or Alt+↑/↓)' : 'Drag to reorder, into or out of a composite (or Alt+↑/↓)'} aria-hidden="true"
          data-tour={m.ref && `module-grip:${m.ref}`} {...grip} />
        <span class="chain-kinds"><span class="kind-badge" title={comp ? KIND_LABELS[m.kind] : undefined}>
          {comp ? '⧉' : KIND_LABELS[m.kind]}</span>
          {std === undefined && !comp && <span class="custom-badge"
            title="Custom code: written by the AI or in the code editor, not a library module">Custom</span>}</span>
        {comp && <button type="button" class="chain-fold" aria-label={fold ? 'Shut' : 'Open'} aria-expanded={fold}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" onClick={pick} />}
        {comp ? <textarea class={cx('chain-name chain-rename', m.title.length > LONG && 'long')}
          aria-label="Composite name" rows={1} maxlength={80}
          spellcheck={false} placeholder={KIND_LABELS[m.kind]} value={m.title}
          title={`${title} — ${STATE_TEXT[state.kind] || state.kind}${state.message ? `: ${state.message}` : ''}`}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          onInput={(e) => set({ title: e.currentTarget.value.replace(/\n/g, ' ') })} />
          : <button type="button" class="chain-name" aria-current={selected} aria-expanded={fold} onClick={pick}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" data-tour={m.ref && `module:${m.ref}`}
          title={`${title} — ${STATE_TEXT[state.kind] || state.kind}${state.message ? `: ${state.message}` : ''}`}>
          {title}</button>}
        {note && <span class="chain-note">{note}</span>}
        {m.kind !== 'warp' && <select class="chain-select wide-only" aria-label={how} title={how}
          value={opts.some(([v]) => v === value) ? value : ''} onChange={(e) => {
            const v = e.currentTarget.value;
            if (blendAs) return blendAs.set(v || undefined);
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
        <button type="button" class="icon-btn wide-only" aria-label={deletion} title={deletion}
          disabled={!deletable} onClick={remove}>🗑</button></div>
      {children}
    </li>);
}
