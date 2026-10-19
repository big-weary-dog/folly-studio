// The installation (SPEC "Rig", public/data/rig.json) and the pattern library's index (public/patterns/index.json),
// as the server reads them: modules (a code file each) and presets (layers of them, in the index). The pattern core
// checks a rig's pixels against its fixtures (prepareScene).
import { z } from 'zod';

import { BLENDS, MODULE_KINDS, SOURCE_BLENDS } from '../../public/js/pattern-core.ts';
import { Globals, ID, MAX_MODULES, Params, Soften } from './look.ts';

const int = (min = 0) => z.number().int().min(min);
const xyz = z.tuple([z.number(), z.number(), z.number()]);
const axis = z.enum(['+x', '-x', '+y', '-y', '+z', '-z']);

export const RigGroup = z.object({
  id: z.string(), name: z.string().optional(), parent: z.string().nullish(), tags: z.array(z.string()).optional(),
  fixtures: z.array(z.string()).optional(), zones: z.array(z.string()).optional(),
  where: z.record(z.string(), z.array(z.number())).optional(), centre: xyz.optional(),
});
export const Fixture = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), name: z.string().optional(), zone: z.string().optional(),
  kind: z.enum(['strip', 'points', 'cells', 'flood']).optional(), start: int(), count: int(),
  render: z.record(z.string(), z.unknown()).optional(),
});
export const Rig = z.object({
  rig: z.literal(1), name: z.string().optional(), about: z.string().optional(), units: z.string().optional(),
  axes: z.object({ up: axis, front: axis, right: axis }).optional(),
  output: z.object({ protocol: z.string().optional(), universes: int(1), channelsPerUniverse: int(3),
    order: z.enum(['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR']).optional(), fps: z.number().positive().optional() }),
  count: int(), bounds: z.object({ min: xyz, max: xyz }), fixtures: z.array(Fixture),
  pixels: z.object({ universe: z.array(int(1)), channel: z.array(int(1)), pos: z.array(z.number()),
    attrs: z.record(z.string(), z.array(z.number())).optional() }),
  groups: z.array(RigGroup).default([]),
  views: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  structure: z.record(z.string(), z.unknown()).optional(),
});

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const shelfed = {
  name: z.string().regex(NAME), title: z.string().optional(), summary: z.string().catch(''),
  tags: z.array(z.unknown()).catch([]).transform((t) => t.filter((x): x is string => typeof x === 'string')),
  category: z.string().catch(''),
};
/** A preset's module: a library module by `ref`, its params, and how it joins its chain (SPEC "Library"). */
const PresetModule = z.strictObject({ ref: z.string().regex(NAME), id: z.string().regex(ID).optional(),
  title: z.string().max(200).optional(), params: Params.optional(), blend: z.enum(SOURCE_BLENDS).optional(),
  as: z.literal('input').optional(), input: z.string().regex(ID).optional(), enabled: z.boolean().optional() });
/** A preset's layer: its chain, and how the layer blends; it plays where the person puts it. */
const PresetLayer = z.strictObject({ title: z.string().max(200).optional(),
  modules: z.array(PresetModule).min(1).max(MAX_MODULES), blend: z.enum(BLENDS).optional(),
  level: z.number().min(0).max(1).optional(), soften: Soften.optional() });
/** A preset: a recipe of layers of library modules, listed in index.json with no code file of its own. */
export const Preset = z.strictObject({ ...shelfed, kind: z.literal('preset'),
  layers: z.array(PresetLayer).min(1).max(4), globals: Globals.optional() })
  .refine((p) => p.layers.every((l) => l.modules.every((m) => !m.input || l.modules.some((x) => x.id === m.input))),
    'a module\'s input names a module of its layer');
const ModuleShape = z.looseObject({ ...shelfed,
  kind: z.enum(MODULE_KINDS as unknown as ['source', 'warp', 'filter']).catch('source') });
// A malformed preset is dropped, never read as a source.
const Module = z.preprocess((e, ctx) => (e && typeof e === 'object' && (e as { kind?: unknown }).kind === 'preset'
  ? (ctx.addIssue('not a preset'), z.NEVER) : e), ModuleShape);
/** An entry of the library's index.json: a module (a name its code file and `use()` go by) or a preset; title,
 * summary and tags filled in. */
export const LibraryEntry = z.union([Preset, Module]).transform((e) => ({ ...e, title: e.title || e.name }));

export type RigGroup = z.infer<typeof RigGroup>;
export type Fixture = z.infer<typeof Fixture>;
export type Rig = z.infer<typeof Rig>;
export type PresetEntry = z.infer<typeof Preset> & { title: string, code: string };
export type ModuleEntry = z.infer<typeof ModuleShape> & { title: string, code: string };
/** A library entry as the API hands it out: a module with its code, or a preset (code ''). */
export type LibraryEntry = ModuleEntry | PresetEntry;
export type PresetLayer = z.infer<typeof PresetLayer>;
