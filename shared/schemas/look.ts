// A look as the API stores it (SPEC "Looks", "Timeline", "Globals", "Param bindings"), strict: a bad look is refused
// with a 400 naming its first problem (problem()). Generators' looks are cleaned leniently first (generated.ts). A
// palette given by name is filled in from data/palettes.json, so a stored look carries its colours.
import { z } from 'zod';

import PALETTES from '../../public/data/palettes.json' with { type: 'json' };
import {
  BLENDS, BLUR_MODES, DIRECTIONS, GLOBALS, macroNameOk, MAX_CLIPS, MAX_DURATION, MAX_LANES, MAX_MACROS, MAX_POINTS,
  MAX_RADIUS, MODULE_KINDS, OLD_DIRECTIONS, PALETTE_ROLES, type Picture, pictureProblem, SOURCE_BLENDS, TRANSITIONS,
} from '../../public/js/pattern-core.ts';

export {
  BLENDS as BLEND_MODES, MODULE_KINDS as KINDS, SOURCE_BLENDS as SOURCE_BLEND_MODES,
} from '../../public/js/pattern-core.ts';
export const MAX_LAYERS = 8;
export const MAX_MODULES = 8;
const MAX_CODE_BYTES = 20 * 1024;
export const MAX_LAYER_CODE_BYTES = 64 * 1024;   // a chain's modules together
export const TAG = /^[a-z0-9-]{1,32}$/;   // a rig group's tag (SPEC "Rig")
export const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
export const HEX = /^#[0-9a-f]{6}$/i;
export const PALETTE_NAMES: readonly string[] = Object.freeze(PALETTES.palettes.map((p) => p.name));
/** A global's or a macro's range. */
export type Range = { min: number, max: number };

export const ms = (v: number) => Math.round(v * 1000) / 1000;   // times are kept to the millisecond
const round = (v: number) => Math.round(v * 1e6) / 1e6;
export const bytes = (s: string) => new TextEncoder().encode(s).length;
/** A finite number from lo to hi; every failure says `error`. */
const num = (lo: number, hi: number, error: string) => z.number({ error }).min(lo).max(hi);
const seconds = (what: string, lo = 0) => num(lo, MAX_DURATION,
  `${what} must be a number of seconds from ${lo} to ${MAX_DURATION}.`).transform(ms);
const oneOf = <T extends readonly [string, ...string[]]>(what: string, list: T) => z.enum(list,
  { error: `${what} must be one of ${list.join(', ')}.` });

// Where an issue is, for problem(): "Layer 2, module 1", "Macro storm", "automation.energy".
const LABELS: Record<string, (k: PropertyKey) => string> = {
  layers: (i) => `Layer ${Number(i) + 1}`, modules: (i) => `module ${Number(i) + 1}`,
  clips: (i) => `clip ${Number(i) + 1}`, params: (k) => `param ${String(k).slice(0, 64)}`,
  macros: (k) => `Macro ${String(k).slice(0, 40)}`, automation: (k) => `automation.${String(k).slice(0, 40)}`,
};

/** The first issue as a sentence: "Layer 2, clip 1: start must be …", "Layer 1, clip 1 must be an object." */
export function problem(error: z.ZodError): string {
  const issue = error.issues[0];
  const message = issue.code === 'invalid_key' ? issue.issues[0]?.message ?? issue.message : issue.message;
  const at: string[] = [];
  for (let i = 0; i < issue.path.length - 1; i++) {
    const label = LABELS[String(issue.path[i])];
    if (label) at.push(label(issue.path[++i]));
  }
  if (!at.length) return message;
  return `${at.join(', ')}${/^(?:must|has) /.test(message) ? ' ' : ': '}${message}`;
}

const Clip = z.object({
  start: seconds('start'), end: seconds('end'), fadeIn: seconds('fadeIn').default(0),
  fadeOut: seconds('fadeOut').default(0),
  transition: z.strictObject({ kind: oneOf('transition.kind', TRANSITIONS),
    direction: oneOf('transition.direction', [...DIRECTIONS, ...OLD_DIRECTIONS]).optional(),
    softness: num(0.001, 1, 'transition.softness must be a number from 0.001 to 1.').optional(),
  }, { error: 'transition must be { kind, direction?, softness? }.' }).optional(),
}, { error: 'must be an object.' }).refine((c) => c.end > c.start, 'end must be after start.');

/** A layer's clips (SPEC "Timeline"): sorted by start; overlaps refused (touching is fine). */
const Clips = z.array(Clip, { error: 'clips must be an array.' }).max(MAX_CLIPS, `at most ${MAX_CLIPS} clips.`)
  .transform((list, ctx) => {
    list.sort((a, b) => a.start - b.start);
    for (let j = 1; j < list.length; j++) {
      const [a, b] = [list[j - 1], list[j]];
      if (b.start < a.end) ctx.addIssue(`clips overlap (${a.start}–${a.end} s and ${b.start}–${b.end} s).`);
    }
    return list;
  });

const bound = z.number().min(-1e6).max(1e6).optional();
const GlobalName = z.string().regex(/^[a-z][A-Za-z0-9_]{0,31}$/);
/** A param bound to an LFO, a global, the clip envelope or the tempo instead of a number (SPEC "Param bindings"). */
export const Binding = z.discriminatedUnion('mod', [
  z.strictObject({ mod: z.literal('lfo'), shape: z.enum(['sine', 'tri', 'saw', 'square', 'hold']).optional(),
    rate: bound, unit: z.enum(['hz', 'beats']).optional(), depth: bound, center: bound,
    hold: z.number().min(0).max(1).optional(), amount: GlobalName.optional(), pace: GlobalName.optional() }),
  z.strictObject({ mod: z.literal('global'), name: GlobalName, from: bound, to: bound }),
  z.strictObject({ mod: z.literal('envelope'), from: bound, to: bound }),
  z.strictObject({ mod: z.literal('beats'), per: bound }),
]);

// A colour pick (SPEC "Palettes"): roles, slots, all, rainbow and '#rrggbb', joined by spaces or dealt by '/'.
const PICK_TOKEN = String.raw`(?:(?:low|body|accent|high)(?:[1-9]|1[0-6])?|all|rainbow|#[0-9a-f]{6})`;
const PICK_TEXT = new RegExp(String.raw`^\s*${PICK_TOKEN}(?:(?:\s*/\s*|\s+)${PICK_TOKEN})*\s*$`, 'i');
export const PickText = z.string().max(200)
  .regex(PICK_TEXT, 'a pick is roles (body), slots (body2), all, rainbow or #rrggbb, separated by spaces or /.');
const UNIT = 'range and rotate are numbers from 0 to 1.';
const unit = z.number({ error: UNIT }).min(0, UNIT).max(1, UNIT);
/** A pick with options: blend (step by default), range (a stretch of the walk), rotate (a turn, or a binding). */
const PickObject = z.strictObject({ pick: PickText, blend: oneOf('blend', ['step', 'smooth']).optional(),
  range: z.tuple([unit, unit]).optional(), rotate: z.union([unit, Binding]).optional() });
export const Pick = z.union([PickText, PickObject]);
/** A picture param's value (SPEC-library "Pictures"), held to the core's limits. */
export const PictureValue = z.custom<Picture>((v) => !pictureProblem(v), { error: 'is not a picture.' });
const ParamValue = z.union([z.number(), z.boolean(), z.string().max(256), z.array(z.number()).max(16), Binding,
  PickObject, PictureValue]);
/** Param overrides: values (numbers, toggles, colours as picks, '#hex' or [r, g, b]), bindings or pictures. */
const Param = z.custom<z.infer<typeof ParamValue>>((v) => ParamValue.safeParse(v).success,
  { error: 'has an unsupported value.' });
export const Params = z.record(z.string().max(64), Param, { error: 'params must be an object.' })
  .refine((p) => Object.keys(p).length <= 64, 'too many params.');

const Code = z.string({ error: 'code must be a string.' })
  .refine((c) => bytes(c) <= MAX_CODE_BYTES, `code is over ${MAX_CODE_BYTES / 1024} kB.`);
const Title = z.string({ error: 'title must be a string of at most 200 characters.' }).max(200);
const Blend = oneOf('blend', BLENDS);
const SourceBlend = oneOf('blend', SOURCE_BLENDS);

const Module = z.object({
  id: z.string().regex(ID).optional(), kind: oneOf('kind', MODULE_KINDS).default('source'), title: Title.default(''),
  ref: z.string({ error: 'ref must name a library entry.' }).regex(/^[a-z0-9-]{1,64}$/).optional(), code: Code,
  params: Params.nullish().transform((p) => p ?? {}),
  input: z.string({ error: 'input must be a module id.' }).regex(ID).optional(),
  as: z.literal('input', { error: "as is only 'input' (a source)." }).optional(), blend: SourceBlend.optional(),
  enabled: z.boolean({ error: 'enabled must be true or false.' }).optional(),
}, { error: 'must be an object.' }).refine((m) => !m.as || m.kind === 'source', "as is only 'input' (a source).");

/** A layer's module chain (SPEC "Modules"): 1–8 modules, ids unique (m1, m2, … by default). */
export const Modules = z.array(Module, { error: `1–${MAX_MODULES} modules.` }).min(1).max(MAX_MODULES)
  .transform((list, ctx) => {
    const ids = new Set<string>();
    let total = 0;
    return list.map(({ id: given, enabled, ...rest }, j) => {
      const id = given ?? `m${j + 1}`;
      if (ids.has(id)) {
        ctx.addIssue({ code: 'custom', message: 'id must be unique, 1–64 letters, digits or _.:-', path: [j, 'id'] });
      }
      ids.add(id);
      total += bytes(rest.code);
      if (total > MAX_LAYER_CODE_BYTES) ctx.addIssue(`its modules' code is over ${MAX_LAYER_CODE_BYTES / 1024} kB.`);
      return { id, ...rest, ...(enabled === false ? { enabled } : {}) };
    });
  });

/** A layer's soften (SPEC "Spatial modules"): a blur at the end of its chain. */
export const Soften = z.strictObject({
  radius: num(0, MAX_RADIUS, `soften.radius must be a number of metres from 0 to ${MAX_RADIUS}.`).transform(round),
  mode: oneOf('soften.mode', BLUR_MODES).default('wire'),
}, { error: 'soften must be { radius, mode }.' });

/** An array of at most `max` of `item`; every failure says `error`. */
const array = (item: (error: string) => z.ZodString, max: number, error: string) => z.array(item(error), { error })
  .max(max);
const list = (...a: Parameters<typeof array>) => array(...a).default([]);
const Layer = z.looseObject({
  id: z.string({ error: 'id must be 1–64 letters, digits or _.:-' }).regex(ID).optional(),
  title: Title.default(''), code: Code.optional(), params: Params.nullish(), modules: Modules.optional(),
  // None given: the rig's root; [] (and no tags): nothing.
  groups: array((error) => z.string({ error }).min(1).max(64), 64, 'groups must be an array of group ids.').optional(),
  tags: list((error) => z.string({ error }).regex(TAG), 16, 'tags must be an array of at most 16 tags (a-z, 0-9, -).'),
  blend: Blend.default('add'), level: num(0, 1, 'level must be a number from 0 to 1.').default(1),
  clips: Clips.nullish(), soften: Soften.nullish(),
}, { error: 'must be an object.' }).superRefine((l, ctx) => {
  const stray = l.code !== undefined || Object.keys(l.params ?? {}).length > 0;
  if (l.modules && stray) ctx.addIssue('a layer has modules or code and params, not both.');
  if (!l.modules && l.code === undefined) {
    ctx.addIssue({ code: 'custom', message: 'code must be a string.', path: ['code'] });
  }
}).transform(({ id, title, code, params, modules, groups, tags, blend, level, clips, soften, palette: _, ...flags },
) => {
  // Small UI flags the client may add (enabled, solo) are kept; anything bulky is dropped, and so is `palette`, a role
  // remap from before every source had one colour pick (dropRemaps).
  const extra = Object.fromEntries(Object.entries(flags).filter(([k, v]) => k.length <= 64
    && (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
      || (typeof v === 'string' && v.length <= 200))).slice(0, 16));
  return { id, title, ...(modules ? { modules } : { code: code!, params: params ?? {} }), ...(groups ? { groups } : {}),
    ...(tags.length ? { tags: [...new Set(tags)] } : {}), blend, level, ...(clips?.length ? { clips } : {}),
    ...(soften ? { soften } : {}), ...extra };
});

/** Layers without `palette`, a role remap from before every source had one colour pick; the same array when none
 * had one (a stored look keeps its identity unless something changed). */
export function dropRemaps<T>(layers: T[]): T[] {
  const has = (l: unknown) => !!l && typeof l === 'object' && 'palette' in l;
  return layers.some(has) ? layers.map((l) => {
    if (!has(l)) return l;
    const { palette: _, ...rest } = l as T & { palette: unknown };
    return rest as T;
  }) : layers;
}

/** A look's layers, bottom first (defaults: blend add, level 1, no groups (the rig's root), ids l1, l2, …). */
export const Layers = z.array(Layer, { error: 'layers must be an array.' })
  .max(MAX_LAYERS, `A look can have at most ${MAX_LAYERS} layers.`)
  .transform((list, ctx) => {
    const ids = new Set<string>();
    return list.map((l, i) => {
      const id = l.id ?? `l${i + 1}`;
      if (ids.has(id)) ctx.addIssue({ code: 'custom', message: `duplicate layer id ${id}.`, path: [i] });
      ids.add(id);
      return { ...l, id };
    });
  });

const role = (r: string) => list((error) => z.string({ error }).regex(HEX), 16,
  `globals.palette.${r} must be up to 16 '#rrggbb' colours.`).transform((hex) => hex.map((c) => c.toLowerCase()));
const HOUSE = PALETTES.palettes.map(({ theme: _, ...p }) => p); // a look stores the colours, not the theme
const Palette = z.union([
  z.string().transform((name, ctx) => structuredClone(HOUSE.find((p) => p.name === name))
    ?? (ctx.addIssue('no such palette'), z.NEVER)),
  z.object({ name: z.string().catch('').transform((n) => n.slice(0, 64)), low: role('low'), body: role('body'),
    accent: role('accent'), high: role('high') })
    .refine((p) => PALETTE_ROLES.some((r) => p[r].length), 'globals.palette has no colours.'),
], { error: (iss) => (typeof iss.input === 'string' ? `globals.palette: no palette called ${iss.input.slice(0, 40)}.`
  : 'globals.palette must be a palette name or { name, low, body, accent, high }.') });

const MIN_MAX = 'min and max must be numbers, max above min.', VALUE = 'value must be a number from min to max.';
const MOD_RULE = "a macro's mod is an LFO, the tempo or a global, not the clip envelope.";
/** A macro: a fader, or with `mod` a modulator every param bound to it follows (SPEC "Globals"). */
const Macro = z.object({ value: z.number({ error: VALUE }).optional(), min: num(-1e6, 1e6, MIN_MAX).default(0),
  max: num(-1e6, 1e6, MIN_MAX).default(1), mod: Binding.refine((b) => b.mod !== 'envelope', MOD_RULE).optional() },
{ error: 'must be { value, min, max, mod? }.' })
  .refine((m) => m.max > m.min, MIN_MAX).refine((m) => m.value === undefined || (m.value >= m.min && m.value <= m.max),
    VALUE)
  .transform((m) => ({ value: round(m.value ?? m.min), min: round(m.min), max: round(m.max),
    ...m.mod ? { mod: m.mod } : {} }));
/** The names a modulator follows: its global, and an LFO's amount and pace. */
export const follows = (b: z.infer<typeof Binding>) => (b.mod === 'global' ? [b.name] : b.mod === 'lfo'
  ? [b.amount, b.pace].filter((n) => n !== undefined) : []);
const MACRO_RULE = 'a name is a lowercase letter, then letters, digits or _, and not one of energy, speed, level, hue, '
  + 'saturation or palette.';

// What a live engine offers as controls (SPEC "Globals"): names of globals, macros and bpm, each once.
const MAX_LIVE = Object.keys(GLOBALS).length + MAX_MACROS + 1;
const LIVE_RULE = "globals.live lists globals, the look's macros or bpm, each once.";

const global = (name: keyof typeof GLOBALS) => num(GLOBALS[name].min, GLOBALS[name].max,
  `globals.${name} must be a number from ${GLOBALS[name].min} to ${GLOBALS[name].max}.`).transform(round).optional();
/** A look's globals (all optional): the built-ins in range, a palette, macros. null clears them. */
export const Globals = z.strictObject({
  speed: global('speed'), level: global('level'), hue: global('hue'), saturation: global('saturation'),
  energy: global('energy'), palette: Palette.optional(),
  macros: z.record(z.string().refine(macroNameOk, MACRO_RULE), Macro,
    { error: 'globals.macros must be an object of { value, min, max }.' })
    .refine((m) => Object.keys(m).length <= MAX_MACROS, `At most ${MAX_MACROS} macros.`).optional(),
  live: z.array(z.string(), { error: LIVE_RULE }).max(MAX_LIVE, LIVE_RULE).optional(),
}, { error: (iss) => (iss.code === 'unrecognized_keys' ? `globals.${String(iss.keys[0]).slice(0, 40)} is not a global.`
  : 'globals must be an object.') }).nullable()
  .refine((g) => !g?.live?.some((n, i, all) => all.indexOf(n) !== i
    || !(Object.hasOwn(GLOBALS, n) || n === 'bpm' || Object.hasOwn(g.macros ?? {}, n))), LIVE_RULE)
  .superRefine((g, ctx) => {   // one level: a modulator follows faders (globals, or macros without a mod)
    for (const [name, m] of Object.entries(g?.macros ?? {})) {
      const bad = m.mod && follows(m.mod).find((n) => !Object.hasOwn(GLOBALS, n) && !(Object.hasOwn(g!.macros!, n)
        && !g!.macros![n].mod));
      if (bad) {
        ctx.addIssue(`globals.macros.${name} follows ${bad}, which is not a global or a macro without a mod: `
          + 'a modulator follows faders only.');
      }
    }
  });

const lane = ({ min, max }: Range) => {
  const each = `each point is [seconds 0–${MAX_DURATION}, value ${min}–${max}].`;
  return z.array(z.tuple([num(0, MAX_DURATION, each).transform(ms), num(min, max, each).transform(round)],
    { error: each }), { error: `must be 1–${MAX_POINTS} points [t, value].` }).min(1).max(MAX_POINTS)
    .transform((pts, ctx) => {
      pts.sort((a, b) => a[0] - b[0]);
      const twice = pts.find((p, i) => i && p[0] === pts[i - 1][0]);
      if (twice) ctx.addIssue(`two points at ${twice[0]} s.`);
      return pts;
    });
};

/**
 * A look's automation for these globals: { name: [[t, v], …] } for the built-in globals and the look's macros,
 * points sorted by time (0–600 s, to the ms; one per time), values in the global's range. null clears it.
 */
export function automationFor(globals: { macros?: Record<string, Range> } | null | undefined) {
  const ranges: Record<string, Range> = { ...GLOBALS, ...globals?.macros };
  return z.strictObject(Object.fromEntries(Object.entries(ranges).map(([name, r]) => [name, lane(r).optional()])),
    { error: (iss) => (iss.code === 'unrecognized_keys' ? `automation.${String(iss.keys[0]).slice(0, 40)}: automate a `
      + "global or one of the look's macros." : 'automation must be an object of lanes.') })
    .refine((a) => Object.keys(a).length <= MAX_LANES, `At most ${MAX_LANES} automation lanes.`)
    .nullable();
}

export const Duration = seconds('duration', 1);
export const Bpm = num(40, 240, 'bpm must be a number from 40 to 240, or null.').transform(ms).nullable();
export const LookTitle = z.string({ error: 'title is required.' }).trim().min(1)
  .max(200, 'title must be at most 200 characters.');
export const Summary = z.string({ error: 'summary must be a string of at most 2000 characters.' }).max(2000).nullish()
  .transform((s) => s?.trim() ?? '');

export type Clip = z.infer<typeof Clip>;
export type Binding = z.infer<typeof Binding>;
export type ParamValue = z.infer<typeof ParamValue>;
export type Module = z.infer<typeof Modules>[number];
export type Layer = z.infer<typeof Layers>[number];
export type Soften = z.infer<typeof Soften>;
export type Palette = NonNullable<z.infer<typeof Palette>>;
export type Pick = z.infer<typeof Pick>;
export type Globals = NonNullable<z.infer<typeof Globals>>;
export type Automation = Partial<Record<string, [number, number][]>>;
