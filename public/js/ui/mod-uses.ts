// What each macro drives (SPEC "Composition"): the params bound to it (a colour's rotate too), the LFOs it swings or
// paces, and the modulators that follow it. The Look panel's chips and the timeline's modulator lanes read it.
import type { Binding } from '../../../shared/schemas/look.ts';
import { bindingText, isBinding } from './bindings.ts';

/** A use of a macro: a param on a layer's module (follows it, or its LFO's swing or pace), or another macro. */
export type Use = { how: 'follows' | 'swing' | 'pace'; layer?: string; module?: string; key?: string;
  macro?: string; b: Binding };

type LookLike = { layers: readonly { id: string; modules: readonly { id: string; params?: Record<string, unknown>
  | null }[] }[]; globals?: { macros?: Record<string, { mod?: Binding }> } | null };

/** Every macro's uses, by name, layers in the look's order. */
export function macroUses(look: LookLike) {
  const out = new Map<string, Use[]>();
  function add(b: Binding, at: Omit<Use, 'how' | 'b'>) {
    const put = (name: unknown, how: Use['how']) => {
      if (typeof name === 'string') out.set(name, [...out.get(name) ?? [], { how, ...at, b }]);
    };
    if (b.mod === 'global') put(b.name, 'follows');
    if (b.mod === 'lfo') { put(b.amount, 'swing'); put(b.pace, 'pace'); }
  }
  for (const l of look.layers) {
    for (const m of l.modules) {
      for (const [key, v] of Object.entries(m.params ?? {})) {
        const rotate = (v as { rotate?: unknown } | null)?.rotate, b = isBinding(v) ? v : isBinding(rotate) ? rotate
          : null;
        if (b) add(b, { layer: l.id, module: m.id, key });
      }
    }
  }
  for (const [macro, m] of Object.entries(look.globals?.macros ?? {})) if (m.mod) add(m.mod, { macro });
  return out;
}

/** A use in words, its place first: "Rose › Speed", "swing of Rose › Level", "pace of breath". */
export function useText(u: Use, place: string) {
  return u.how === 'follows' ? place : `${u.how} of ${place}`;
}

/** How a modulator moves, in short: "∿ sine ¼ beat × storm · swing × energy". */
export function moveText(mod: Binding) {
  const text = bindingText(mod, { min: 0, max: 1 }).replace(/ · [^·]*$/, '');
  return mod.mod === 'lfo' && mod.amount ? `${text} · swing × ${mod.amount}` : text;
}
