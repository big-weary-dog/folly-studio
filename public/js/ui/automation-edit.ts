// Make a timeline lane, optionally binding a setting to it, in one undoable look edit.
import type { Binding } from '../../../shared/schemas/look.ts';
import { MAX_LANES, MAX_MACROS } from '../core/globals.ts';
import { isBinding, type Param } from './bindings.ts';
import { humanize, toast } from './kit.tsx';
import { freeName } from './look-globals-edit.ts';
import { editValue, readEdit } from './pick-model.ts';
import type { Draft, Studio } from './studio-store.ts';

export type AutomationTarget = { macro?: string; layer?: string; module?: string; key?: string; hint?: string;
  colour?: { value: unknown; blend: 'step' | 'smooth' } };
type Range = Pick<Param, 'label' | 'min' | 'max'>;

/** The macro, lane and setting binding travel together; an existing lane keeps its points and mapping. */
export function automationEdit(L: Draft, p: Range, value: number, target: AutomationTarget = {}):
  { name: string; patch: Partial<Draft> } | null {
  const macros = L.globals?.macros ?? {}, lanes = L.automation ?? {};
  const layer = L.layers.find((l) => l.id === target.layer);
  const module = layer?.modules.find((m) => m.id === target.module), key = target.key;
  if (!target.macro && key && !module) return null;
  const saved = key && module?.params?.[key];
  const current = target.colour ? readEdit(saved, target.colour.value).rotate : saved;
  const bound = isBinding(current) && current.mod === 'global' && lanes[current.name] ? current.name : undefined;
  const existing = target.macro ?? bound;
  if (existing && !macros[existing]) return null;
  if (existing && lanes[existing]) return { name: existing, patch: {} };
  if (Object.keys(lanes).length >= MAX_LANES || (!existing && Object.keys(macros).length >= MAX_MACROS)) return null;
  const name = existing ?? freeName(macros, target.hint ?? 'automation', key ? p.label : '');
  const m = existing ? macros[existing]! : { min: p.min, max: p.max,
    value: Math.min(p.max, Math.max(p.min, Number.isFinite(value) ? value : (p.min + p.max) / 2)) };
  const initial = Math.min(m.max, Math.max(m.min, Number.isFinite(value) ? value : m.value));
  const patch: Partial<Draft> = { globals: { ...L.globals, macros: { ...macros, [name]: m } },
    automation: { ...lanes, [name]: [[0, initial], [L.duration || 30, initial]] } };
  if (!target.macro && key && module) {
    const b: Binding = { mod: 'global', name, from: p.min, to: p.max };
    const v = target.colour ? editValue({ ...readEdit(saved, target.colour.value), rotate: b }, target.colour.blend)
      ?? { pick: 'all', rotate: b } : b;
    patch.layers = L.layers.map((l) => l.id !== target.layer ? l : { ...l,
      modules: l.modules.map((mod) => mod.id !== target.module ? mod
        : { ...mod, params: { ...mod.params, [key]: v } }) });
  }
  return { name, patch };
}

/** Creates and reveals a lane without requiring someone to find the timeline or learn a shortcut. */
export function automate(st: Studio, p: Range = { label: 'Automation', min: 0, max: 1 }, value = 0.5,
  target: AutomationTarget = {}) {
  const result = automationEdit(st.look.peek(), p, value, target);
  if (!result) { toast('At most 16 macros and automation lanes per look.', { kind: 'warn' }); return false; }
  if (Object.keys(result.patch).length) st.edit(() => result.patch);
  if (!st.look.peek().automation?.[result.name]) return false;   // editing a version preview was refused
  st.showDock('timeline');
  st.setTab('time', { onlyNarrow: true });
  toast(`Automating ${humanize(result.name)}`);
  let tries = 20;
  const reveal = () => {
    const row = document.querySelector(`.tl-auto-row[data-name="${result.name}"]`);
    if (row) row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    else if (--tries) requestAnimationFrame(reveal);
  };
  requestAnimationFrame(reveal);
  return true;
}
