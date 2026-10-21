// Pure: a module's params as controls (SPEC "Pattern code") and number params' bindings (SPEC "Param bindings"):
// the schema entry a control shows, a binding in a few words, and the binding the modulate dialog makes.
import type { Binding, ParamValue } from '../../../shared/schemas/look.ts';
import { readText } from '../core/globals.ts';
import { type Picture, readPicture } from '../core/picture.ts';
import { humanize } from './kit.tsx';

export interface Param { kind: 'number' | 'color' | 'toggle' | 'choice' | 'picture' | 'text';
  value: number | string | boolean | Picture;
  label: string; min: number; max: number; step: number; options: string[]; blend?: 'smooth' | 'step'; help?: string;
  unit?: 'minute'; lines?: boolean }
type Shape = NonNullable<Extract<Binding, { mod: 'lfo' }>['shape']>;
export type BindingForm = { mod: '' | Binding['mod']; shape: Shape; rate: string; unit: string; lo: string;
  hi: string; hold: string; amount: string; pace: string; name: string; from: string; to: string; eFrom: string;
  eTo: string; per: string };
export const SHAPES: Shape[] = ['sine', 'tri', 'saw', 'square', 'hold'];

/** A choice option as the UI says it: the library's directions (SPEC "Directions") with arrows, else humanized. */
const DIRECTION_TEXT: Record<string, string> = { up: 'Up ↑', down: 'Down ↓', right: 'Across →', left: 'Across ←',
  back: 'Front → back', front: 'Back → front', out: 'Out from the centre', in: 'In to the centre',
  clockwise: 'Clockwise ↻', counterclockwise: 'Counterclockwise ↺', along: 'Along the strands',
  'orbit-clockwise': 'Orbit, clockwise from above', 'orbit-counterclockwise': 'Orbit, counterclockwise from above' };
export const optionText = (key: string, options: string[]) => (options.every((o) => o in DIRECTION_TEXT)
  ? DIRECTION_TEXT[key] : humanize(key));

/** Is v a param binding rather than a value? */
export const isBinding = (v: unknown): v is Binding => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof (v as Binding).mod === 'string';
export const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
/** Rates in beats as the popover offers them: cycles a beat for a period of ¼ beat … 4 bars (4 beats a bar). */
export const RATES: [string, number][] = [['¼ beat', 4], ['½ beat', 2], ['1 beat', 1], ['1 bar', 0.25],
  ['2 bars', 0.125], ['4 bars', 0.0625]];
/** A rate in beats in words: a pill's name, else "every n beats". */
export const rateText = (rate: number) => RATES.find((r) => r[1] === rate)?.[0] ?? `every ${fmt(1 / rate)} beats`;

const HEX = /^#[0-9a-f]{6}$/i;

export const GLYPHS: Record<Shape, string> = { sine: '∿', tri: '⋀', saw: '⟋', square: '⊓', hold: '⌒' };
/** A binding in a few words, with the range it moves through (`r`, the param's; a rotate's is 0..1):
 * "∿ sine ½ beat · −55…95", "◆ storm · 20…160", "⌂ clip envelope · 0…1", "♩ 0.5 a beat". */
export function bindingText(b: Binding, r = { min: 0, max: 1 }) {
  const span = (a: number, z: number) => ` · ${fmt(a)}…${fmt(z)}`;
  if (b.mod === 'lfo') {
    const shape = b.shape || 'sine', c = b.center ?? (r.min + r.max) / 2, d = b.depth ?? (r.max - r.min) / 4;
    const rate = b.unit === 'beats' ? rateText(b.rate ?? 1) : `${fmt(b.rate ?? 1)} Hz`;
    return `${GLYPHS[shape]} ${shape} ${rate}${b.pace ? ` × ${b.pace}` : ''}${span(c - d, c + d)}`;
  }
  if (b.mod === 'beats') return `♩ ${fmt(b.per ?? 1)} a beat`;
  const ends = span(b.from ?? r.min, b.to ?? r.max);
  return b.mod === 'global' ? `◆ ${b.name}${ends}` : `⌂ clip envelope${ends}`;
}

/** One entry of the core's schema (normalizeParams) as a control, or null. */
export function normaliseParam(key: string, raw: unknown): Param | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>, label = typeof r.label === 'string' ? r.label : humanize(key), v = r.value;
  const base = { label, min: 0, max: 1, step: 1, options: [],
    ...typeof r.help === 'string' && r.help ? { help: r.help } : {} };
  if (r.type === 'color') {
    return { ...base, kind: 'color', value: typeof v === 'string' ? v : toHex(v),
      ...(r.blend === 'smooth' || r.blend === 'step' ? { blend: r.blend } : {}) };
  }
  if (r.type === 'toggle') return { ...base, kind: 'toggle', value: !!v };
  if (r.type === 'picture') {
    const pic = readPicture(v);
    return pic && { ...base, kind: 'picture', value: pic };
  }
  if (r.type === 'text') {
    return { ...base, kind: 'text', value: readText(v) ?? '', ...r.lines === true ? { lines: true } : {} };
  }
  if (r.type === 'choice' && Array.isArray(r.options) && r.options.length) {
    const options = r.options.map(String);
    return { ...base, kind: 'choice', value: options.includes(v as string) ? v as string : options[0], options };
  }
  if (typeof v !== 'number') return null;
  const min = Number.isFinite(r.min) ? r.min as number : 0, max = Number(r.max) > min ? r.max as number : min + 1;
  const x = (max - min) / 200, p = 10 ** Math.floor(Math.log10(x)), nice = (x / p < 2 ? 1 : x / p < 5 ? 2 : 5) * p;
  return { ...base, kind: 'number', value: v, min, max, step: Number(r.step) > 0 ? r.step as number : nice,
    ...(r.unit === 'minute' ? { unit: 'minute' as const } : {}) };
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
  if (p.kind === 'picture') return { has, bound: false, value: readPicture(v) ?? p.value };
  if (p.kind === 'text') return { has, bound: false, value: readText(v) ?? p.value as string };
  const own = p.kind === 'color' ? toHex(v) : p.kind !== 'choice' ? !!v : p.options.includes(v as string) ? v : p.value;
  return { has, bound: false, value: own as string | boolean };
}

/** The popover's fields for a param's binding (or none yet). An LFO is From/To (stored as centre ± depth); a new one
 * swings a quarter of the range each side of `now` (the field's value), and a beat binding keeps `now` at `bpm`.
 * Global and envelope keep their ends apart. */
export function bindingForm(b: Partial<Binding>, p: Param, globals: string[], now = Number(p.value), bpm = 120)
  : BindingForm {
  const o = b as Record<string, unknown>, ends = (mod: string) => (b.mod === mod
    ? [fmt(Number(o.from ?? p.min)), fmt(Number(o.to ?? p.max))] : [fmt(p.min), fmt(p.max)]);
  const [from, to] = ends('global'), [eFrom, eTo] = ends('envelope'), q = (p.max - p.min) / 4;
  const centre = Number(o.center ?? p.value), depth = Number(o.depth ?? q);
  const [lo, hi] = b.mod === 'lfo' ? [centre - depth, centre + depth]
    : [Math.max(p.min, now - q), Math.min(p.max, now + q)];
  const hz = b.mod === 'lfo' && o.unit !== 'beats', rate = Number(o.rate ?? 0.25);
  return { mod: b.mod || '', shape: SHAPES.includes(o.shape as Shape) ? o.shape as Shape : 'sine',
    rate: hz ? fmt(rate) : String(rate), unit: hz ? 'hz' : 'beats', // in beats exact: 4 bars is 1/16 a beat
    lo: fmt(lo), hi: fmt(hi), hold: fmt(Number(o.hold ?? 0.5)), amount: String(o.amount ?? ''),
    pace: String(o.pace ?? ''),
    name: globals.includes(o.name as string) ? o.name as string : globals[0], from, to, eFrom, eTo,
    per: fmt(Number(o.per ?? now * 60 / bpm)) };
}

/** The binding the popover's fields make (null: its field sets it); a number that does not parse takes its default. */
export function makeBinding(f: BindingForm, p: Param): Binding | null {
  const n = (s: string, d: number) => { const v = parseFloat(s); return Number.isFinite(v) ? v : d; };
  if (f.mod === 'lfo') {
    const lo = n(f.lo, p.min), hi = n(f.hi, p.max);
    return { mod: 'lfo', shape: f.shape, rate: n(f.rate, 1), unit: f.unit === 'beats' ? 'beats' : 'hz',
      center: (lo + hi) / 2, depth: (hi - lo) / 2,
      ...(f.shape === 'hold' ? { hold: Math.min(0.95, Math.max(0, n(f.hold, 0.5))) } : {}),
      ...(f.amount ? { amount: f.amount } : {}), ...(f.pace ? { pace: f.pace } : {}) };
  }
  if (f.mod === 'global') return { mod: 'global', name: f.name, from: n(f.from, p.min), to: n(f.to, p.max) };
  if (f.mod === 'beats') return { mod: 'beats', per: n(f.per, 1) };
  return f.mod === 'envelope' ? { mod: 'envelope', from: n(f.eFrom, p.min), to: n(f.eTo, p.max) } : null;
}

/** Does a param take the beat clock: a speed (things a second), or a rate a minute. Heartbeat's own tempo is a
 * tempo, not a speed. */
export const keepsTime = (key: string, p: Param) => p.kind === 'number' && (p.unit === 'minute' || /speed/i.test(key));
/** A clocked speed's label: its count a beat, not a second or a minute ("Speed (clouds a beat)"). */
export const perBeat = (label: string) => label.replace(/\ba (second|minute)\b/, 'a beat');
/** The beats a second at `bpm` (a minute, on a `unit: 'minute'` param): a beat binding is `per` × this. */
export const beatsAt = (bpm: number, p: Param) => (p.unit === 'minute' ? bpm : bpm / 60);

/** A modulator's LFO shared out of a param's (SPEC "Globals"): the macro's 0..1 swing, and the param's binding to it
 * through the same ends, so the param moves exactly as before. */
export function shareLfo(b: Extract<Binding, { mod: 'lfo' }>, p: Param, name: string) {
  const c = b.center ?? Number(p.value), d = b.depth ?? (p.max - p.min) / 4;
  return { mod: { ...b, center: 0.5, depth: 0.5 } as Binding,
    binding: { mod: 'global', name, from: c - d, to: c + d } as Binding };
}

/** What upgrade() changed (SPEC-library "Pattern code"), for the params the schema declares whose saved value is
 * still what it changed (an edit since wins): the sandbox's report, so untrusted. */
export function upgradedOf(up: unknown, schema: Record<string, unknown> | null, saved: Record<string, unknown>) {
  const json = (v: unknown) => JSON.stringify(v);
  return Object.fromEntries(Object.entries(up && typeof up === 'object' ? up : {})
    .filter(([k, v]) => schema && k in schema && Array.isArray(v) && json(v[0]) === json(saved[k]))
    .map(([k, v]) => [k, v[1]])) as Record<string, ParamValue>;
}
