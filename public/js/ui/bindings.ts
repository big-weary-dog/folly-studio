// Pure: a module's params as controls (SPEC "Pattern code") and number params' bindings (SPEC "Param bindings"):
// the schema entry a control shows, a binding in a few words, and the binding the modulate dialog makes.
import type { Binding, ParamValue } from '../../../shared/schemas/look.ts';
import { humanize } from './kit.tsx';

export interface Param { kind: 'number' | 'color' | 'toggle' | 'choice'; value: number | string | boolean;
  label: string; min: number; max: number; step: number; options: string[]; blend?: 'smooth' | 'step' }
type Shape = NonNullable<Extract<Binding, { mod: 'lfo' }>['shape']>;
export type BindingForm = { mod: '' | Binding['mod']; shape: Shape; rate: string; unit: string; center: string;
  depth: string; hold: string; name: string; from: string; to: string; eFrom: string; eTo: string };
export const SHAPES: Shape[] = ['sine', 'tri', 'saw', 'square', 'hold'];

/** A choice option as the UI says it: the library's directions (SPEC "Directions") with arrows, else humanized. */
const DIRECTION_TEXT: Record<string, string> = { up: 'Up ↑', down: 'Down ↓', right: 'Across →', left: 'Across ←',
  back: 'Front → back', front: 'Back → front', out: 'Out from the centre', in: 'In to the centre',
  round: 'Round, clockwise', along: 'Along the strands' };
export const optionText = (key: string, options: string[]) => (options.every((o) => o in DIRECTION_TEXT)
  ? DIRECTION_TEXT[key] : humanize(key));

/** Is v a param binding rather than a value? */
export const isBinding = (v: unknown): v is Binding => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof (v as Binding).mod === 'string';
export const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
const HEX = /^#[0-9a-f]{6}$/i;

/** A binding in a few words: "LFO sine · 0.25 Hz", "energy → 0–2", "envelope → 0–1". */
export function bindingText(b: Binding) {
  if (b.mod === 'lfo') return `LFO ${b.shape || 'sine'} · ${fmt(b.rate ?? 1)} ${b.unit === 'beats' ? '/beat' : 'Hz'}`;
  const range = b.from !== undefined || b.to !== undefined ? ` → ${fmt(b.from ?? 0)}–${fmt(b.to ?? 1)}` : '';
  return `${b.mod === 'global' ? b.name : 'envelope'}${range}`;
}

/** One entry of the core's schema (normalizeParams) as a control, or null. */
export function normaliseParam(key: string, raw: unknown): Param | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>, label = typeof r.label === 'string' ? r.label : humanize(key), v = r.value;
  const base = { label, min: 0, max: 1, step: 1, options: [] };
  if (r.type === 'color') {
    return { ...base, kind: 'color', value: typeof v === 'string' ? v : toHex(v),
      ...(r.blend === 'smooth' || r.blend === 'step' ? { blend: r.blend } : {}) };
  }
  if (r.type === 'toggle') return { ...base, kind: 'toggle', value: !!v };
  if (r.type === 'choice' && Array.isArray(r.options) && r.options.length) {
    const options = r.options.map(String);
    return { ...base, kind: 'choice', value: options.includes(v as string) ? v as string : options[0], options };
  }
  if (typeof v !== 'number') return null;
  const min = Number.isFinite(r.min) ? r.min as number : 0, max = Number(r.max) > min ? r.max as number : min + 1;
  const x = (max - min) / 200, p = 10 ** Math.floor(Math.log10(x)), nice = (x / p < 2 ? 1 : x / p < 5 ? 2 : 5) * p;
  return { ...base, kind: 'number', value: v, min, max, step: Number(r.step) > 0 ? r.step as number : nice };
}

/** A colour value ('#rrggbb' or [r, g, b] 0..1) as '#rrggbb'. */
export function toHex(v: unknown) {
  if (typeof v === 'string' && HEX.test(v)) return v.toLowerCase();
  const byte = (c: unknown) => Math.round(Math.min(1, Math.max(0, Number(c) || 0)) * 255).toString(16).padStart(2, '0');
  return Array.isArray(v) && v.length >= 3 ? `#${v.slice(0, 3).map(byte).join('')}` : '#ffffff';
}

/** What a control shows for a module's value: its own, the code's default, or none while a binding moves it. */
export function shownValue(p: Param, values: Record<string, ParamValue>, key: string) {
  const has = Object.hasOwn(values, key), v = values[key];
  if (p.kind === 'number') {
    const bound = has && isBinding(v);
    return { has, bound, value: bound ? NaN : has && Number.isFinite(Number(v)) ? Number(v) : p.value };
  }
  if (!has) return { has, bound: false, value: p.value };
  const own = p.kind === 'color' ? toHex(v) : p.kind !== 'choice' ? !!v : p.options.includes(v as string) ? v : p.value;
  return { has, bound: false, value: own as string | boolean };
}

/** The dialog's fields for a param's binding (or none yet); global and envelope keep their ends apart. */
export function bindingForm(b: Partial<Binding>, p: Param, globals: string[]): BindingForm {
  const o = b as Record<string, unknown>, ends = (mod: string) => (b.mod === mod
    ? [fmt(Number(o.from ?? p.min)), fmt(Number(o.to ?? p.max))] : [fmt(p.min), fmt(p.max)]);
  const [from, to] = ends('global'), [eFrom, eTo] = ends('envelope');
  return { mod: b.mod || '', shape: SHAPES.includes(o.shape as Shape) ? o.shape as Shape : 'sine',
    rate: fmt(Number(o.rate ?? 0.25)), unit: o.unit === 'beats' ? 'beats' : 'hz',
    center: fmt(Number(o.center ?? p.value)),
    depth: fmt(Number(o.depth ?? (p.max - p.min) / 4)), hold: fmt(Number(o.hold ?? 0.5)),
    name: globals.includes(o.name as string) ? o.name as string : globals[0], from, to, eFrom, eTo };
}

/** The binding the dialog's fields make (null: its field sets it); a number that does not parse takes its default. */
export function makeBinding(f: BindingForm, p: Param): Binding | null {
  const n = (s: string, d: number) => { const v = parseFloat(s); return Number.isFinite(v) ? v : d; };
  if (f.mod === 'lfo') {
    return { mod: 'lfo', shape: f.shape, rate: n(f.rate, 1), unit: f.unit === 'beats' ? 'beats' : 'hz',
      center: n(f.center, Number(p.value)), depth: n(f.depth, (p.max - p.min) / 4),
      ...(f.shape === 'hold' ? { hold: Math.min(1, Math.max(0, n(f.hold, 0.5))) } : {}) };
  }
  if (f.mod === 'global') return { mod: 'global', name: f.name, from: n(f.from, p.min), to: n(f.to, p.max) };
  return f.mod === 'envelope' ? { mod: 'envelope', from: n(f.eFrom, p.min), to: n(f.eTo, p.max) } : null;
}
