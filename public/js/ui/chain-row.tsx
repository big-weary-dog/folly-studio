// A module's row in a chain (chain.tsx): its joint on the came and the reaches crossing it, a grip to drag it, its
// kind, Custom when it is not a library module, name, how a source (or composite) combines or which input a filter
// reads, enable and delete; a composite's name opens and closes its sub-layers (chain-tree.tsx), its children.
import type { ComponentChildren } from 'preact';

import type { Module } from '../../../shared/schemas/look.ts';
import { cx } from './kit.tsx';
import { BLEND_MODES, KIND_LABELS, type Reach } from './model.ts';
import type { TreeDrag } from './tree-drag.ts';

export const STATE_TEXT: Record<string, string> = { ok: 'Running', off: 'Off', pending: 'Compiling…',
  compile: 'Compile error', runtime: 'Runtime error', hung: 'Hung' };
const INPUT_ONLY = 'input';
// How a source joins.
const GLYPHS: Record<string, string> = { over: '●', under: '○', add: '+', multiply: '×', max: '▴' };
const isSource = (m: Module) => m.kind === 'source' || m.kind === 'composite';

type Grip = ReturnType<TreeDrag['grip']>;

/** A module's row; `slot`: its drop slot's key; `fold`: whether what is under it shows (the selected module's
 * settings on wide screens, a composite's sub-layers), its children; `note`: a word after its name. */
export function ModuleRow({ m, i, mods, first, selected, std, grip, slot, drop, dragging, join, reach, lit, state,
  pick, remove, nudge, set, fold, note, children }: { m: Module; i: number; mods: Module[]; first: number;
  selected: boolean; std?: string; grip: Grip; slot: string; drop?: string; dragging: boolean; join: string;
  reach: Reach[]; lit: number; state: { kind: string; message?: string }; pick: (e: MouseEvent) => void;
  remove: () => void; nudge: (e: KeyboardEvent) => void; set: (patch: Partial<Module>) => void; fold?: boolean;
  note?: string; children?: ComponentChildren }) {
  const title = std ?? (m.title || KIND_LABELS[m.kind]), filter = m.kind === 'filter';
  // The row's select as a patch: a source's blend (or input only), a filter's input. A source's default ('') is
  // Over first and Add after, so that blend is not offered twice.
  const dflt = i === first ? 'over' : 'add';
  const opts = filter ? [['', 'No input'], ...mods.slice(0, i).filter(isSource)
    .map((s) => [s.id, s.title || 'Source'])]
    : [['', dflt === 'over' ? 'Over' : 'Add'], ...BLEND_MODES.filter((b) => b.value !== dflt)
      .map((b) => [b.value, b.label]), ['under', 'Under'], [INPUT_ONLY, 'Input only']];
  const value = filter ? m.input || '' : m.as === 'input' ? INPUT_ONLY : m.blend === dflt ? '' : m.blend || '';
  const how = filter ? 'Input' : 'Combine';
  return (
    <li class={cx('chain-row', selected && 'selected', m.enabled === false && 'off', dragging && 'dragging')}
      data-kind={m.kind} data-module={m.id} data-join={join} data-status={state.kind}
      data-drop={drop} data-tour-area onKeyDown={nudge}
      onClick={(e) => { if (e.target === e.currentTarget && !selected) pick(e); }}>
      <span class="chain-joint" aria-hidden="true">{GLYPHS[join]}</span>
      {reach.map((r) => <span class={cx('reach', r.to === lit && 'lit')} aria-hidden="true" data-kind={r.kind}
        style={{ '--lane': r.lane }} data-part={i === r.from ? 'from' : i === r.to ? 'to' : 'via'} />)}
      <div class="chain-top" data-slot={slot}>
        <span class="grip" title="Drag to reorder, into or out of a composite (or Alt+↑/↓)" aria-hidden="true"
          {...grip} />
        <span class="chain-kinds"><span class="kind-badge">{KIND_LABELS[m.kind]}</span>
          {std === undefined && m.kind !== 'composite' && <span class="custom-badge"
            title="Custom code: written by the AI or in the code editor, not a library module">Custom</span>}</span>
        <button type="button" class="chain-name" aria-current={selected} aria-expanded={fold} onClick={pick}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" data-tour={m.ref && `module:${m.ref}`}
          title={`${title} — ${STATE_TEXT[state.kind] || state.kind}${state.message ? `: ${state.message}` : ''}`}>
          {title}{note && <span class="chain-note">{note}</span>}</button>
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
