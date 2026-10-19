// The installation (SPEC "Rig", public/data/rig.json) and the pattern library's index (public/patterns/index.json),
// as the server reads them. The pattern core checks a rig's pixels against its fixtures (prepareScene).
import { z } from 'zod';

import { MODULE_KINDS } from '../../public/js/pattern-core.ts';

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

/** An entry of the library's index.json: a name the code file and `use()` go by; title, summary and tags filled in. */
export const LibraryEntry = z.looseObject({
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/), title: z.string().optional(),
  summary: z.string().catch(''), tags: z.array(z.unknown()).catch([])
    .transform((t) => t.filter((x): x is string => typeof x === 'string')),
  kind: z.enum(MODULE_KINDS as unknown as ['source', 'warp', 'filter']).catch('source'), category: z.string().catch(''),
}).transform((e) => ({ ...e, title: e.title || e.name }));

export type RigGroup = z.infer<typeof RigGroup>;
export type Fixture = z.infer<typeof Fixture>;
export type Rig = z.infer<typeof Rig>;
export type LibraryEntry = z.infer<typeof LibraryEntry> & { code: string };
