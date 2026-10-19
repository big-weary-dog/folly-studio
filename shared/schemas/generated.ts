// What a generator hands back (SPEC "Generators"), cleaned leniently: aliases and out-of-range values are mended, what
// cannot be used is dropped with a note, and globals and automation are then held to the API's rules (look.ts). The
// same schema, as JSON Schema (wireSchema), is the claude generator's structured output. Generated code is untrusted:
// it is only inspected here as text, never run.
import { z } from 'zod';

import {
  BLENDS, BLUR_MODES, DEFAULT_SOFTEN, GLOBALS, macroNameOk, MAX_LANES, MAX_MACROS, MAX_POINTS, MAX_RADIUS, MODULE_KINDS,
  pickText, readPick, SOURCE_BLENDS,
} from '../../public/js/pattern-core.ts';
import type { Blend, BlurMode, ModuleKind, SourceBlend } from '../../public/js/pattern-core.ts';
import {
  automationFor, Binding, bytes, Globals as StrictGlobals, ID, ms, PALETTE_NAMES, Pick, problem, TAG,
} from './look.ts';
import type { Automation, Globals, Module, Range, Soften } from './look.ts';

export const LIMITS = Object.freeze({ layers: 4, modules: 6, codeBytes: 20 * 1024, title: 80, layerTitle: 80,
  summary: 400, params: 32, clips: 32, duration: 600 });
const BLEND_ALIASES: Record<string, Blend> = { maximum: 'max', normal: 'over', mult: 'multiply', screen: 'max',
  lighten: 'max' };
const KIND_ALIASES: Record<string, ModuleKind> = { pattern: 'source', effect: 'filter', transform: 'warp' };
const FUNCTION: Record<string, string> = { source: 'pixel', warp: 'warp', filter: 'filter' };
const PARAM_NAME = /^[A-Za-z_$][\w$]{0,63}$/;
// Control characters other than tab/newline/CR; they have no place in code or text we store.
// oxlint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isString = (v: unknown): v is string => typeof v === 'string';

/** An error whose `userMessage` is safe to show to the person who submitted the idea. */
export class GenerateError extends Error {
  name = 'GenerateError'; userMessage: string;
  constructor(userMessage: string, detail?: string) {
    super(detail ? `${userMessage} (${detail})` : userMessage);
    this.userMessage = userMessage;
  }
}

/** Collapse whitespace, drop control characters, and cut to `max` characters at a word boundary. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const s = value.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, '');
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}

/** Code that defines `fn` (its kind's function), with a Markdown fence the model may add stripped; ≤ 20 kB. */
const code = (fn: string) => z.string().catch('').refine((c) => c.trim(), { error: 'has no code', abort: true })
  .transform((c) => (/^\s*(`{3,}|~{3,})[\w-]*[ \t]*\n([\s\S]*?)\n?\1\s*$/.exec(c.replace(/\r\n?/g, '\n'))?.[2]
    ?? c.replace(/\r\n?/g, '\n')).replace(CONTROL, ''))
  .refine((c) => bytes(c) <= LIMITS.codeBytes, { error: 'code is over 20 kB', abort: true })
  .refine((c) => new RegExp(`\\bfunction\\s+${fn}\\s*\\(`).test(c), { error: `code does not define function ${fn}` });
const text = (max: number) => z.string().catch('').transform((s) => cleanText(s, max));
const blend = z.string().catch('').transform((b) => b.trim().toLowerCase())
  .transform((b): Blend => (BLENDS.includes(b as Blend) ? b as Blend : BLEND_ALIASES[b] ?? 'add'))
  .meta({ enum: [...BLENDS] });
const sourceBlend = z.string().catch('').transform((b) => b.trim().toLowerCase())
  .transform((b): SourceBlend => (SOURCE_BLENDS.includes(b as SourceBlend) ? b as SourceBlend
    : BLEND_ALIASES[b] ?? 'add')).meta({ enum: [...SOURCE_BLENDS] });
const level = z.number().transform((n) => clamp(n, 0, 1)).catch(1);
/** Seconds, from a number or a numeric string. */
const time = z.preprocess((v) => (typeof v === 'string' && v.trim() ? Number(v) : v), z.number());
const fade = time.transform((v) => ms(clamp(v, 0, LIMITS.duration))).catch(0);
const tags = z.array(z.unknown()).catch([])
  .transform((t) => [...new Set(t.filter((x): x is string => isString(x) && TAG.test(x)))].slice(0, 16));
/** A colour pick as stored (SPEC "Palettes"): its known tokens, its options when they are usable; else undefined. */
function cleanPick(v: unknown) {
  const p = typeof v === 'string' && !v.includes('#') && /^\s*[0-9a-f]{3,6}\s*$/i.test(v) ? null : readPick(v);
  if (!p || Array.isArray(v)) return undefined;
  const pick = pickText(p.groups), o = v && typeof v === 'object' ? v as Record<string, unknown> : null;
  const turn = Binding.safeParse(o?.rotate).data ?? (p.rotate ? p.rotate - Math.floor(p.rotate) : undefined);
  const out = Pick.safeParse(o ? { pick, ...(p.blend ? { blend: p.blend } : {}), ...(p.range ? { range: p.range } : {}),
    ...(turn !== undefined ? { rotate: turn } : {}) } : pick).data;
  return typeof out === 'object' && Object.keys(out).length === 1 ? out.pick : out;
}
// Params stay out of the model's schema: a pattern's code carries its defaults. A word is a choice param's value;
// a colour's is a pick.
const param = z.union([z.number(), z.boolean(), z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  z.tuple([z.number(), z.number(), z.number()]).transform((c) => c.map((x) => clamp(x, 0, 1))), Binding,
  z.unknown().transform((v, ctx) => cleanPick(v) ?? (ctx.addIssue('not a value'), z.NEVER))]);
const params = z.record(z.string(), z.unknown()).catch({}).transform((p) => Object.fromEntries(Object.entries(p)
  .filter(([k]) => PARAM_NAME.test(k) && k !== '__proto__').flatMap(([k, v]) => {
    const r = param.safeParse(v);
    return r.success ? [[k, r.data]] : [];
  }).slice(0, LIMITS.params))).meta({ omit: true });

/** A layer's soften: one the model gave, held to range, else DEFAULT_SOFTEN (generated layers soften their edges). */
const soften = z.unknown().optional().transform((v): Soften => {
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : {};
  if (typeof o.radius !== 'number' || !Number.isFinite(o.radius)) return { ...DEFAULT_SOFTEN };
  return { radius: Math.round(clamp(o.radius, 0, MAX_RADIUS) * 1000) / 1000,
    mode: BLUR_MODES.includes(o.mode as BlurMode) ? o.mode as BlurMode : 'wire' };
}).meta({ omit: true });

/** A list item that fails is kept as its reason, so the list can note it by position. */
type Dropped = { dropped: string };
const orDrop = <T extends z.ZodType>(item: T) => item.catch((c) => ({ dropped: c.error.issues[0].message }) as never);
const isDropped = (x: unknown): x is Dropped => !!x && typeof x === 'object' && 'dropped' in x;
/** What was kept, at most `max`; each item dropped is noted as `${label} ${i + 1}: why`. */
function keep<T>(list: (T | Dropped)[], label: string, max: number, notes: string[]): T[] {
  const out: T[] = [];
  list.forEach((x, i) => {
    if (out.length >= max) notes.push(`${label} ${i + 1}: more than ${max} ${label}s`);
    else if (isDropped(x)) notes.push(`${label} ${i + 1}: ${x.dropped}`);
    else out.push(x);
  });
  return out;
}

const clip = z.object({ start: time, end: time, fadeIn: fade, fadeOut: fade })
  .refine((c) => [c.start, c.end].every((t) => t >= 0 && t <= LIMITS.duration) && ms(c.end) > ms(c.start))
  .transform((c) => ({ ...c, start: ms(c.start), end: ms(c.end) }));
/** Clips as the API stores them: sorted, at most 32; bad ones and one overlapping the clip before go, noted. */
const clips = z.preprocess((v) => v ?? undefined, z.array(orDrop(clip)).optional()).catch(() => 'not a list' as never)
  .transform((v): { clips: z.infer<typeof clip>[], notes: string[] } => {
    if (!Array.isArray(v)) return { clips: [], notes: v ? ['clips is not a list'] : [] };
    const notes = v.filter(isDropped).map(() => 'a clip without a valid start and end');
    const out: z.infer<typeof clip>[] = [];
    for (const c of v.filter((x) => !isDropped(x)).sort((a, b) => a.start - b.start)) {
      if (out.length >= LIMITS.clips) notes.push(`more than ${LIMITS.clips} clips`);
      else if (out.length && c.start < out.at(-1)!.end) notes.push(`a clip at ${c.start} s overlapping the one before`);
      else out.push(c);
    }
    return { clips: out, notes };
  });

type Library = { name: string }[];
const moduleOf = (library: Library) => z.object({
  id: z.string().optional().catch(undefined),
  kind: z.string().catch('source').transform((k, ctx): ModuleKind => {
    const kind = k.trim().toLowerCase();
    if (FUNCTION[kind]) return kind as ModuleKind;
    return KIND_ALIASES[kind] ?? (ctx.addIssue(`unknown kind ${k.slice(0, 20)}`), z.NEVER);
  }).meta({ enum: [...MODULE_KINDS] }),
  title: text(LIMITS.layerTitle), ref: z.string().optional().catch(undefined),
  code: z.unknown().optional().meta({ type: 'string' }),
  params, input: z.string().optional().catch(undefined), as: z.literal('input').optional().catch(undefined),
  blend: sourceBlend.optional(),
}, { error: 'not an object' }).meta({ required: ['id', 'kind', 'title', 'code'] }).transform((m, ctx) => {
  const checked = code(FUNCTION[m.kind]!).safeParse(m.code);
  if (!checked.success) return (ctx.addIssue(checked.error.issues[0].message), z.NEVER);
  const ref = library.some((p) => p.name === m.ref) ? m.ref : undefined;
  return { id: m.id, kind: m.kind, title: m.title || ref || m.kind, ...(ref ? { ref } : {}), code: checked.data,
    params: m.params, ...(m.kind === 'filter' && m.input ? { input: m.input } : {}),
    ...(m.kind === 'source' && m.as ? { as: m.as } : {}), ...(m.blend !== undefined ? { blend: m.blend } : {}) };
});

/** A chain as stored: ids unique (else m1, m2, …), a filter's input an earlier source's; null without a source. */
function chain(list: (z.infer<ReturnType<typeof moduleOf>> | Dropped)[], notes: string[]): Module[] | null {
  const ids = new Set<string>();
  const out = keep(list, 'module', LIMITS.modules, notes).map((m, j) => {
    const id = m.id && ID.test(m.id) && !ids.has(m.id) ? m.id : `m${j + 1}`;
    ids.add(id);
    return { ...m, id } as Module;
  });
  for (const [j, m] of out.entries()) {
    if (m.input && !out.slice(0, j).some((s) => s.id === m.input && s.kind === 'source')) delete m.input;
  }
  return out.some((m) => m.kind === 'source') ? out : null;
}

type Group = { id?: unknown, parent?: unknown, tags?: unknown };
const layerOf = (library: Library, known: Set<string>, root: string, groupTags: string[]) => z.object({
  title: text(LIMITS.layerTitle),
  groups: z.preprocess((g) => (isString(g) ? [g] : g), z.array(z.unknown())).catch([])
    .transform((g) => [...new Set(g.filter(isString).map((x) => x.trim()).filter((x) => known.has(x)))])
    .meta({ items: known.size <= 400 ? { type: 'string', enum: [...new Set([root, ...known])] } : { type: 'string' } }),
  tags: tags.meta({ items: groupTags.length ? { type: 'string', enum: groupTags } : { type: 'string' } }),
  blend, level, clips, soften, code: z.unknown().optional().meta({ type: 'string' }), params,
  modules: z.array(orDrop(moduleOf(library))).optional().catch(undefined),
}, { error: 'not an object' }).meta({ required: ['title', 'groups', 'blend', 'level'] }).transform((l, ctx) => {
  const notes = [...l.clips.notes];
  let own;
  if (l.modules?.length) {
    const modules = chain(l.modules, notes);
    if (!modules) return (ctx.addIssue('no usable source module'), z.NEVER);
    own = { modules };
  } else {
    const checked = code('pixel').safeParse(l.code);
    if (!checked.success) return (ctx.addIssue(checked.error.issues[0].message), z.NEVER);
    own = { code: checked.data, params: l.params };
  }
  // Known group ids; none: the root, or nothing when tags say where it goes (SPEC "Looks").
  const groups = l.groups.length ? l.groups : l.tags.length ? [] : [root];
  return { title: l.title, ...own, groups, ...(l.tags.length ? { tags: l.tags } : {}), blend: l.blend,
    level: l.level, ...(l.clips.clips.length ? { clips: l.clips.clips } : {}), soften: l.soften, notes };
});

const range = (d: Range) => z.number().transform((v) => clamp(v, d.min, d.max)).optional()
  .catch(undefined);
const maybe = z.number().optional().catch(undefined);
const macro = z.object({ name: z.unknown().optional().meta({ type: 'string' }), value: maybe, min: maybe, max: maybe })
  .meta({ required: ['name', 'value', 'min', 'max'] });
/** Globals as the model gives them (macros a list or a map, the palette by name) → stored, or undefined. */
const globalsOf = z.object({
  speed: range(GLOBALS.speed), level: range(GLOBALS.level), hue: range(GLOBALS.hue),
  saturation: range(GLOBALS.saturation), energy: range(GLOBALS.energy),
  palette: z.unknown().optional().meta({ type: 'string', enum: [...PALETTE_NAMES] }),
  macros: z.preprocess((m) => (m && typeof m === 'object' && !Array.isArray(m)
    ? Object.entries(m).map(([name, x]) => ({ ...x, name })) : m), z.array(orDrop(macro))).catch([]),
}).meta({ required: [] });
const automationOf = z.preprocess((a) => (a && typeof a === 'object' && !Array.isArray(a)
  ? Object.entries(a).map(([name, points]) => ({ name, points })) : a),
z.array(orDrop(z.object({ name: z.string(), points: z.array(orDrop(z.array(z.number()))) })))).catch([]);

function cleanGlobals(g: z.infer<typeof globalsOf>, notes: string[]): Globals | undefined {
  const out: Record<string, unknown> = Object.fromEntries(Object.entries(g)
    .filter(([k, v]) => k in GLOBALS && v !== undefined));
  const p = g.palette;
  const name = isString(p) ? p.trim().toLowerCase() : (p as { name?: unknown } | null)?.name;
  if (isString(name) && PALETTE_NAMES.includes(name)) out.palette = name;
  else if (p != null) notes.push(`palette ${String(name).slice(0, 30)} is not one of ${PALETTE_NAMES.join(', ')}`);
  const macros: Record<string, { value: number, min: number, max: number }> = {};
  for (const m of g.macros.slice(0, MAX_MACROS)) {
    if (isDropped(m) || !macroNameOk(m.name)) {
      notes.push(`macro ${isDropped(m) ? '?' : String(m.name).slice(0, 30)}: not a usable name`);
      continue;
    }
    const min = m.min ?? 0, max = m.max !== undefined && m.max > min ? m.max : min + 1;
    macros[m.name] = { value: clamp(m.value ?? min, min, max), min, max };
  }
  if (Object.keys(macros).length) out.macros = macros;
  return strict('globals', StrictGlobals, out, notes) ?? undefined;
}

function cleanAutomation(lanes: z.infer<typeof automationOf>, globals: Globals | undefined, notes: string[]) {
  const out: Automation = {}, ranges: Record<string, Range> = { ...GLOBALS, ...globals?.macros };
  for (const lane of lanes.slice(0, MAX_LANES)) {
    const r = !isDropped(lane) && Object.hasOwn(ranges, lane.name) && ranges[lane.name];
    if (isDropped(lane) || !r) {
      notes.push(`automation of ${isDropped(lane) ? '?' : lane.name.slice(0, 30)}`);
      continue;
    }
    const seen = new Set<number>();
    const points = lane.points.filter((p): p is number[] => !isDropped(p) && p.length >= 2)
      .map((p): [number, number] => [ms(clamp(p[0], 0, LIMITS.duration)), clamp(p[1], r.min, r.max)])
      .sort((x, y) => x[0] - y[0]).filter((p) => !seen.has(p[0]) && seen.add(p[0])).slice(0, MAX_POINTS);
    if (points.length) out[lane.name] = points;
  }
  return strict('automation', automationFor(globals), out, notes) ?? undefined;
}

/** The API's rule on what was kept: undefined when nothing was, or (noted) when the rule refuses it. */
function strict<T>(what: string, schema: z.ZodType<T>, kept: object, notes: string[]): T | undefined {
  if (!Object.keys(kept).length) return undefined;
  const r = z.object({ [what]: schema }).safeParse({ [what]: kept });
  if (r.success) return r.data[what] as T;
  notes.push(`${what}: ${problem(r.error)}`);
  return undefined;
}

/** The generator's look, for these groups (their ids an enum for the model) and library (a module's `ref`). */
export function generatedLook({ groups = [], library = [] }: { groups?: Group[], library?: Library } = {}) {
  const known = new Set(groups.map((g) => g?.id).filter(isString));
  const root = groups.find((g) => g && g.parent == null)?.id;
  const groupTags = [...new Set(groups.flatMap((g) => (Array.isArray(g?.tags) ? g.tags.filter(isString) : [])))];
  return z.object({
    title: text(LIMITS.title), summary: text(LIMITS.summary),
    duration: time.transform((d) => ms(clamp(d, 1, LIMITS.duration))).optional().catch(undefined),
    globals: globalsOf.optional().catch(undefined), automation: automationOf.optional(),
    layers: z.array(orDrop(layerOf(library, known, isString(root) ? root : 'all', groupTags))).catch([]),
  }, { error: 'The generator returned something that is not a look.' })
    .meta({ required: ['title', 'summary', 'layers'] });
}

/**
 * A generator's output, `{ title, summary, duration?, globals?, automation?, layers: [{ title, groups, tags?, blend,
 * level, clips?, code + params? | modules }] }`, validated and normalised → the look as stored, with `dropped`:
 * why each dropped thing went. Throws GenerateError when nothing usable is left.
 */
export function validateLook(raw: unknown, ctx: { groups?: Group[], library?: Library } = {}) {
  const r = generatedLook(ctx).safeParse(raw);
  if (!r.success) throw new GenerateError('The generator returned something that is not a look.');
  const dropped: string[] = [];
  const layers = keep(r.data.layers, 'layer', LIMITS.layers, dropped).map(({ notes, ...l }, i) => {
    dropped.push(...notes.map((n) => `layer ${i + 1}: ${n}`));
    return { id: `l${i + 1}`, ...l, title: l.title || `Layer ${i + 1}` };
  });
  if (!layers.length) {
    const why = dropped.length ? dropped[0].replace(/^layer \d+: /, '') : 'no layers';
    throw new GenerateError('The generator did not produce a usable pattern.', why);
  }
  const { title, summary, duration } = r.data;
  const globals = r.data.globals && cleanGlobals(r.data.globals, dropped);
  const automation = r.data.automation && cleanAutomation(r.data.automation, globals, dropped);
  return { title: title || 'Untitled look', summary, ...(duration !== undefined ? { duration } : {}), layers,
    ...(globals ? { globals } : {}), ...(automation ? { automation } : {}), dropped };
}

const KEEP = new Set(['type', 'properties', 'required', 'items', 'enum', 'const', 'anyOf', 'description']);
/** JSON Schema as structured output takes it: every object closed, no bounds, defaults or patterns. */
function wire(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(wire);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'properties') {
      out[k] = Object.fromEntries(Object.entries(v as object).filter(([, p]) => !p?.omit)
        .map(([n, p]) => [n, wire(p)]));
    } else if (KEEP.has(k)) out[k] = k === 'enum' || k === 'required' ? v : wire(v);
  }
  if (out.type === 'object') {
    out.additionalProperties = false;
    out.required = ((out.required ?? []) as string[]).filter((n) => n in (out.properties as object));
  }
  return out;
}

/** The structured-output schema for a look on this rig: group ids (up to 400) and tags as enums. */
export const wireSchema = (groups: Group[] = []) =>
  wire(z.toJSONSchema(generatedLook({ groups }), { io: 'input', unrepresentable: 'any' })) as Record<string, unknown>;
