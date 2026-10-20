// Macro edits that reach across the look (SPEC "Globals"): renaming or deleting one carries its lane, the params
// bound to it and the modulators that follow it; sharing a param's LFO adds a modulator, which ∿ edits and renames.
import type { Binding, Globals, ParamValue } from '../../../shared/schemas/look.ts';
import { macroNameOk } from '../core/globals.ts';
import { isBinding } from './bindings.ts';
import type { Draft, Studio } from './studio-store.ts';

type Macro = NonNullable<Globals['macros']>[string];

/** A binding with every reference to macro `from` renamed (to null: a global binding dropped, an amount or pace
 * cleared); undefined when it goes. */
export function renamed(b: Binding, from: string, to: string | null): Binding | undefined {
  if (b.mod === 'global') return b.name !== from ? b : to ? { ...b, name: to } : undefined;
  if (b.mod !== 'lfo' || (b.amount !== from && b.pace !== from)) return b;
  const out = { ...b };
  for (const k of ['amount', 'pace'] as const) if (out[k] === from) { if (to) out[k] = to; else delete out[k]; }
  return out;
}

/** A macro renamed (to null: deleted): its automation lane, the params bound to it (a colour's rotate too) and the
 * modulators that follow it come along. */
export function renameMacro(L: Draft, from: string, to: string | null): Partial<Draft> {
  const macros = Object.fromEntries(Object.entries(L.globals?.macros || {}).flatMap(([k, v]): [string, Macro][] => {
    if (k === from) return to ? [[to, v]] : [];
    if (!v.mod) return [[k, v]];
    const mod = renamed(v.mod, from, to) as Macro['mod'], m = { ...v };
    if (mod) m.mod = mod; else delete m.mod;
    return [[k, m]];
  }));
  const auto = { ...L.automation };
  if (auto[from]) { if (to) auto[to] = auto[from]; delete auto[from]; }
  const layers = L.layers.map((l) => ({ ...l, modules: l.modules.map((m) => {
    const params = { ...m.params };
    for (const [k, v] of Object.entries(params)) {
      if (isBinding(v)) {
        const b = renamed(v, from, to);
        if (b) params[k] = b; else delete params[k];
      } else if (v && typeof v === 'object' && 'rotate' in v && isBinding(v.rotate)) {
        const rotate = renamed(v.rotate, from, to);
        params[k] = { ...v, rotate: rotate ?? 0 };
      }
    }
    return { ...m, params };
  }) }));
  return { globals: { ...L.globals, macros: Object.keys(macros).length ? macros : undefined },
    automation: Object.keys(auto).length ? auto : undefined, layers };
}

/** A free macro name from each part's first word, camelCased: ("Rose window", "Speed (bars a second)") → roseSpeed,
 * then roseSpeed2… */
export function freeName(taken: Record<string, unknown>, ...parts: string[]) {
  const words = parts.map((p) => p.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/ +/)[0]).filter(Boolean);
  const base = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('').replace(/^[^a-z]+/, '')
    .slice(0, 28) || 'mod';
  const free = (n: string) => !taken[n] && macroNameOk(n);
  let n = 2;
  if (free(base)) return base;
  while (!free(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** A new modulator (a 0..1 macro moved by `mod`), named from where it is shared (a place, a param); its name. */
export function addModulator(st: Studio, mod: Binding, ...hint: string[]) {
  const name = freeName(st.look.peek().globals?.macros ?? {}, ...hint);
  st.editGlobals((g) => ({ ...g, macros: { ...g.macros, [name]: { value: 0.5, min: 0, max: 1,
    mod: mod as Macro['mod'] } } }));
  return name;
}

/** What ∿'s popover may do to a modulator: rename it (false: the name is taken or not allowed) and set how it moves
 * (a binding; a number or undefined: it stops moving, a fader again). */
export function modulatorEdits(st: Studio) {
  return {
    rename(from: string, to: string) {
      if (!macroNameOk(to) || st.look.peek().globals?.macros?.[to]) return false;
      st.edit((L) => renameMacro(L, from, to));
      return true;
    },
    mod(name: string, v: ParamValue | undefined) {
      st.editGlobals((g) => {
        const m = g.macros?.[name];
        if (!m) return g;
        const { mod: _, ...rest } = m;
        return { ...g, macros: { ...g.macros, [name]: isBinding(v) ? { ...m, mod: v as Macro['mod'] }
          : typeof v === 'number' ? { ...rest, value: v } : rest } };
      });
    },
  };
}
