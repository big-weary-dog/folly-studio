// The library as the generators' vocabulary: each module's params read statically from its `const params = {…}`
// (a plain literal in every library file; anything else is refused, never evaluated), and the summary the prompt
// shows: one line a module (what it looks like, its params with their ranges or choices and defaults; the rest is in
// the docs), a preset as its recipe.
// Sorted by name, so its bytes stay the same between calls.

import { DIRECTIONS, MODULE_KINDS, type Picture, readPicture, withSourceParams } from '../../public/js/pattern-core.ts';
import type { LibraryEntry, ModuleEntry, PresetEntry } from '../../shared/schemas/rig.ts';

export type ParamDecl = ({ type: 'number', value: number, min: number, max: number }
  | { type: 'color', value: string, blend?: string } | { type: 'toggle', value: boolean }
  | { type: 'choice', value: string, options: string[] } | { type: 'picture', value: Picture }
  | { type: 'text', value: string })
  & { label?: string, help?: string };

const isPreset = (e: LibraryEntry): e is PresetEntry => e.kind === 'preset';

/** The text of `const params = { … }`'s object, or null. */
function paramsBlock(code: string) {
  const start = /\bconst\s+params\s*=\s*\{/.exec(code);
  if (!start) return null;
  let depth = 0;
  for (let end = start.index + start[0].length - 1; end < code.length; end++) {
    if (code[end] === '{') depth++;
    else if (code[end] === '}' && --depth === 0) return code.slice(start.index + start[0].length - 1, end + 1);
  }
  return null;
}

/** A JS object literal of numbers, strings, booleans, arrays, objects and DIRECTIONS → its value; null when it is
 * anything else (a call, an expression, a name). */
function readLiteral(text: string): unknown {
  const json = text
    .replace(/'((?:[^'\\\n]|\\.)*)'/g, (_, s: string) => JSON.stringify(s.replace(/\\(.)/g, '$1')))
    .replace(/\/\/[^\n"]*$/gm, '')
    .replace(/\bDIRECTIONS\b/g, JSON.stringify(DIRECTIONS))
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/([:[,]\s*)(-?)\.(\d)/g, '$1$20.$3')
    .replace(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(json); } catch { return null; }
}

/** A module's declared params, by name; {} without a readable `const params`. */
export function readParams(code: string): Record<string, ParamDecl> {
  const block = paramsBlock(code || '');
  const raw = block && readLiteral(block);
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, ParamDecl> = {};
  for (const [name, d] of Object.entries(raw as Record<string, Record<string, unknown>>)) {
    if (!d || typeof d !== 'object') continue;
    const v = d.value, label = { ...typeof d.label === 'string' ? { label: d.label } : {},
      ...typeof d.help === 'string' && d.help.trim() ? { help: d.help.trim() } : {} };
    if (d.type === 'color' && typeof v === 'string') {
      out[name] = { type: 'color', value: v, ...(typeof d.blend === 'string' ? { blend: d.blend } : {}), ...label };
    } else if (d.type === 'toggle') out[name] = { type: 'toggle', value: v === true, ...label };
    else if (d.type === 'choice' && Array.isArray(d.options) && typeof v === 'string') {
      out[name] = { type: 'choice', value: v, options: d.options.map(String), ...label };
    } else if (d.type === 'picture' && readPicture(v)) {
      out[name] = { type: 'picture', value: readPicture(v)!, ...label };
    } else if (d.type === 'text' && typeof v === 'string') {
      out[name] = { type: 'text', value: v, ...label };
    } else if (typeof v === 'number' && typeof d.min === 'number' && typeof d.max === 'number') {
      out[name] = { type: 'number', value: v, min: d.min, max: d.max, ...label };
    }
  }
  return out;
}

export type Catalog = { modules: Map<string, ModuleEntry & { params: Record<string, ParamDecl> }>,
  presets: Map<string, PresetEntry>, text: string };

const oneLine = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim();
const n = (v: number) => String(+v.toFixed(3));

/** A param as the catalogue line shows it: `speed 0–2 (0.5)`, `mirror on/off (off)`, `dir up|down (up)`. */
export function describeParam(name: string, d: ParamDecl) {
  if (d.type === 'number') return `${name} ${n(d.min)}–${n(d.max)} (${n(d.value)})`;
  if (d.type === 'toggle') return `${name} on/off (${d.value ? 'on' : 'off'})`;
  if (d.type === 'choice') return `${name} ${d.options.join('|')} (${d.value})`;
  if (d.type === 'color') return `${name} colour (${d.value})`;
  if (d.type === 'text') return `${name} text (${d.value})`;
  return `${name} picture`;
}

/** The library as data and as the prompt's text; `looks`: a module's line from its docs, else its summary.
 * Deterministic for a given library. */
export function buildCatalog(library: readonly LibraryEntry[] = [], looks: ReadonlyMap<string, string> = new Map()):
  Catalog {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const modules = new Map(library.filter((e) => e && !isPreset(e) && typeof e.code === 'string').sort(byName)
    .map((e) => [e.name, { ...(e as ModuleEntry), params: (e.kind ?? 'source') === 'source'
      ? withSourceParams(readParams(e.code)) as Record<string, ParamDecl> : readParams(e.code) }]));
  const presets = new Map(library.filter((e): e is PresetEntry => !!e && isPreset(e)).sort(byName)
    .filter((p) => p.layers.every((l) => l.modules.every((m) => modules.has(m.ref)))).map((p) => [p.name, p]));
  const COMMON = withSourceParams({}) as Record<string, ParamDecl>;
  const kindOf = (e: ModuleEntry) => (MODULE_KINDS.includes(e.kind) ? e.kind : 'source');
  const sections = MODULE_KINDS.map((kind) => {
    const list = [...modules.values()].filter((m) => kindOf(m) === kind);
    // every source's own params; the common ones (Brightness) said once, in the heading
    const shown = (m: ModuleEntry & { params: Record<string, ParamDecl> }) => Object.entries(m.params)
      .filter(([k, d]) => !(kind === 'source' && JSON.stringify(d) === JSON.stringify(COMMON[k])));
    const lines = list.map((m) => `- ${m.name}: ${oneLine(looks.get(m.name) || m.summary)}${
      shown(m).length ? ` [${shown(m).map(([k, d]) => describeParam(k, d)).join('; ')}]` : ''}`);
    const head = kind === 'source' ? ` (each also has ${Object.entries(COMMON).map(([k, d]) => describeParam(k, d))
      .join('; ')})` : '';
    return list.length ? `${kind[0]!.toUpperCase()}${kind.slice(1)}s${head}:\n${lines.join('\n')}` : '';
  }).filter(Boolean);
  if (presets.size) {
    const recipe = (p: PresetEntry) => p.layers.map((l) => l.modules.map((m) => m.ref).join(' → ')).join(' | ');
    sections.push(`Presets:\n${[...presets.values()].map((p) => `- ${p.name}: ${recipe(p)} — ${
      oneLine(looks.get(p.name) || p.summary)}`)
      .join('\n')}`);
  }
  return { modules, presets, text: sections.join('\n\n') };
}
