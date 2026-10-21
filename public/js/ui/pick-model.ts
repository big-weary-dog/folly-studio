// Pure: a colour pick as the pick tile edits it (SPEC "Palettes"): its tokens in order and whether its roles are
// dealt in turn, with blend, range and rotate; back to the value a param or a layer's role stores.
import type { Binding, Pick } from '../../../shared/schemas/look.ts';
import { type PickBlend, pickText, readPick } from '../core/picks.ts';
import { PALETTE_ROLES } from '../core/stdlib.ts';

export type PickEdit = { tokens: string[]; deal: boolean; blend?: PickBlend; range?: [number, number];
  rotate?: number | Binding };
const SLOT = /^(low|body|accent|high)(\d*)$/;
const isBinding = (v: unknown): v is Binding => !!v && typeof v === 'object' && 'mod' in v;

/** The stored value (or, when it has none it can use, the default) as an edit. */
export function readEdit(value: unknown, dflt: unknown): PickEdit {
  const own = readPick(value), spec = own || readPick(dflt);
  const o = own && value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const tokens = spec ? pickText(spec.groups).split(/[\s/]+/).filter(Boolean) : [];
  return { tokens, deal: (spec?.groups.length ?? 0) > 1, ...(own?.blend ? { blend: own.blend } : {}),
    ...(own?.range ? { range: [own.range[0], own.range[1]] } : {}),
    ...(isBinding(o.rotate) ? { rotate: o.rotate } : own?.rotate ? { rotate: own.rotate } : {}) };
}

/** Tokens as text: in order, or dealt as one group per role (slots with their role; all, rainbow and colours alone). */
export function editText(e: PickEdit) {
  if (!e.deal) return e.tokens.join(' ');
  const groups = new Map<string, string[]>();
  e.tokens.forEach((t, i) => {
    const key = SLOT.exec(t)?.[1] ?? `${i}`;
    groups.set(key, [...groups.get(key) ?? [], t]);
  });
  return [...groups.values()].map((g) => g.join(' ')).join('/');
}

/** What to store: nothing for no tokens (the default plays), a string, or { pick, … } with the options that differ
 * from the defaults (blend: the slot's). */
export function editValue(e: PickEdit, dfltBlend: PickBlend): Pick | undefined {
  if (!e.tokens.length) return undefined;
  const pick = editText(e), range = e.range && (e.range[0] !== 0 || e.range[1] !== 1) ? e.range : undefined;
  const opts = { ...(e.blend && e.blend !== dfltBlend ? { blend: e.blend } : {}), ...(range ? { range } : {}),
    ...(e.rotate ? { rotate: e.rotate } : {}) };
  return Object.keys(opts).length ? { pick, ...opts } : pick;
}

const has = (e: PickEdit, t: string) => e.tokens.includes(t);
const without = (e: PickEdit, drop: (t: string) => boolean): PickEdit => ({ ...e,
  tokens: e.tokens.filter((t) => !drop(t)) });
const roleOf = (t: string) => SLOT.exec(t)?.[1];
/** Without the whole-palette tokens: a role or slot picked over them is picked instead of them. */
const unwhole = (e: PickEdit) => without(e, (t) => t === 'all' || t === 'rainbow');

/** A role's state on the tile: all of it, its slots picked (1-based), or none. */
export function roleState(e: PickEdit, role: string) {
  return { whole: has(e, role), slots: new Set(e.tokens.filter((t) => roleOf(t) === role && t !== role)
    .map((t) => Number(t.slice(role.length)))) };
}

/** The whole role in or out (in: in place of its slots). */
export function toggleRole(e: PickEdit, role: string): PickEdit {
  if (has(e, role)) return without(e, (t) => roleOf(t) === role);
  const w = unwhole(e), at = w.tokens.findIndex((t) => roleOf(t) === role);
  const rest = without(w, (t) => roleOf(t) === role).tokens;
  rest.splice(at < 0 ? rest.length : at, 0, role);
  return { ...e, tokens: rest };
}

/** One slot in or out; out of a whole role, the role becomes its other `count` slots; in over the whole palette, it
 * alone. */
export function toggleSlot(e: PickEdit, role: string, n: number, count: number): PickEdit {
  const slot = `${role}${n}`;
  if (has(e, slot)) return without(e, (t) => t === slot);
  if (!has(e, role)) return { ...e, tokens: [...unwhole(e).tokens, slot] };
  const others = Array.from({ length: count }, (_, i) => `${role}${i + 1}`).filter((t) => t !== slot);
  return { ...e, tokens: e.tokens.flatMap((t) => (t === role ? others : [t])) };
}

/** How many custom colours the tile adds (a pick from code may hold more). */
export const CUSTOM_MAX = 4;
/** A custom colour ('#rrggbb') added at the end, once, while there are fewer than CUSTOM_MAX; over the whole palette or
 * rainbow, in place of them, as a slot is. */
export const addColour = (e: PickEdit, hex: string): PickEdit => (has(e, hex)
  || e.tokens.filter((t) => t.startsWith('#')).length >= CUSTOM_MAX ? e
  : { ...e, tokens: [...unwhole(e).tokens, hex] });

/** A token (all, rainbow, a '#rrggbb') in or out. */
export const toggleToken = (e: PickEdit, t: string): PickEdit => (has(e, t) ? without(e, (x) => x === t)
  : { ...e, tokens: [...e.tokens, t] });

/** The palette's roles that have colours, with how many. */
export const rolesOf = (palette: Partial<Record<(typeof PALETTE_ROLES)[number], readonly string[]>>) => PALETTE_ROLES
  .map((role) => ({ role, colours: palette[role] ?? [] }));
