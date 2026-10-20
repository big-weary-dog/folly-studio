// What a prompted generator returns (SPEC "Generators"): a look composed from the library by name. A layer is a
// preset (with overrides) or a chain of modules, each a library module by `use` with its params; an extension, code
// the model writes, is the last resort, used as `ext:<name>` and justified by `why`. Its place (groups, tags, blend,
// level, clips), the globals and the automation are the generated look's own (wireSchema), so the two cannot drift.
// expand.ts turns it into a generated look, which validateLook then cleans as before.

import { MODULE_KINDS, SOURCE_BLENDS } from '../../public/js/pattern-core.ts';
import { wireSchema } from '../../shared/schemas/generated.ts';
import type { RigGroup } from '../../shared/schemas/rig.ts';
import type { Catalog } from './catalog.ts';

type Schema = Record<string, unknown>;
const num = { type: 'number' }, str = { type: 'string' };
const object = (properties: Schema, required: string[]) => ({ type: 'object', properties, required,
  additionalProperties: false });
const list = (items: Schema) => ({ type: 'array', items });

/** A picture (SPEC-library "Pictures"), its key as a list (expand.ts makes it the object the core reads). */
const PICTURE = object({ grid: { type: 'string', enum: ['rose', 'square'] }, repeat: num,
  key: list(object({ char: str, colour: str }, ['char', 'colour'])),
  frames: list(object({ rows: list(str), hold: num }, ['rows'])) }, ['grid', 'key', 'frames']);
/** A param's value: a number, toggle, word (a choice or a colour pick), a binding (an LFO, a global, the clip's
 * envelope) or a picture. */
const VALUE = { anyOf: [num, { type: 'boolean' }, str, object({
  mod: { type: 'string', enum: ['lfo', 'global', 'envelope'] },
  shape: { type: 'string', enum: ['sine', 'tri', 'saw', 'square', 'hold'] }, rate: num,
  unit: { type: 'string', enum: ['hz', 'beats'] }, depth: num, center: num, hold: num, name: str, from: num, to: num,
}, ['mod']), PICTURE] };
const PARAMS = list(object({ name: str, value: VALUE }, ['name', 'value']));

/** The composition's JSON Schema, for structured output: group ids and tags as enums (from the generated look's),
 * preset names as one. */
export function compositionSchema(groups: readonly RigGroup[] = [], catalog?: Pick<Catalog, 'presets'>): Schema {
  const look = wireSchema(groups as RigGroup[]) as { properties: Record<string, Schema> };
  const place = (look.properties.layers!.items as { properties: Record<string, Schema> }).properties;
  const presets = [...catalog?.presets.keys() ?? []];
  const use = object({ use: str, id: str, params: PARAMS, blend: { type: 'string', enum: [...SOURCE_BLENDS] },
    input: str, as: { type: 'string', enum: ['input'] } }, ['use']);
  const layer = object({
    title: place.title!, groups: place.groups!, tags: place.tags!, blend: place.blend!, level: place.level!,
    clips: place.clips!,
    preset: presets.length ? { type: 'string', enum: presets } : str,
    overrides: list(object({ module: str, name: str, value: VALUE }, ['module', 'name', 'value'])),
    modules: list(use),
  }, ['title', 'groups', 'blend', 'level']);
  const extension = object({ name: str, kind: { type: 'string', enum: [...MODULE_KINDS] }, summary: str, why: str,
    code: str }, ['name', 'kind', 'summary', 'why', 'code']);
  const { title, summary, duration, globals, automation } = look.properties;
  return object({ title: title!, summary: summary!, duration: duration!, globals: globals!, automation: automation!,
    layers: list(layer), extensions: list(extension) }, ['title', 'summary', 'layers']);
}
