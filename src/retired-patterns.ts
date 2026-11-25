// Retired library patterns (SPEC-looks "Library only"): the library-only step switches a module naming one to today's
// closest library pattern, a preset's modules in its place, keeping the params that mean the same there; a layer
// holding one with no match is dropped, the look kept.
import { isNode, type Node } from '../shared/look-modules.ts';
import { ID, MAX_MODULES } from '../shared/schemas/look.ts';
import type { Library } from './library-files.ts';

type Switch = { preset: string, params: Record<string, string> } | null;
const BUTTERFLY: Switch = { preset: 'butterfly', params: { colours: 'colours' } };
const PLASMA: Switch = { preset: 'plasma', params: { colours: 'colours' } };
const LIGHTHOUSE: Switch = { preset: 'lighthouse', params: { colours: 'colours', beams: 'bars' } };

/** Each retired pattern: the preset now closest and its params by the name they take on the preset's source, or null
 * for none. Butterfly, plasma and lighthouse were the -classic ones' names before presets took them. */
export const RETIRED: Readonly<Record<string, Switch>> = {
  'butterfly-classic': BUTTERFLY, butterfly: BUTTERFLY, 'plasma-classic': PLASMA, plasma: PLASMA,
  'lighthouse-classic': LIGHTHOUSE, lighthouse: LIGHTHOUSE, tendril: null, 'stained-glass': null,
};

const retiredRef = (m: Node) => (typeof m.ref === 'string' && Object.hasOwn(RETIRED, m.ref) ? m.ref : null);
const text = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The ids in a chain, its composites' sub-layers' too. */
function idsOf(modules: unknown[], ids = new Set<string>()) {
  for (const m of modules.filter(isNode)) {
    if (typeof m.id === 'string') ids.add(m.id);
    for (const sub of Array.isArray(m.layers) ? m.layers.filter(isNode) : []) {
      if (Array.isArray(sub.modules)) idsOf(sub.modules, ids);
    }
  }
  return ids;
}

/** `base`, or with a number after it, an id the layer does not have yet (now taken). */
function fresh(ids: Set<string>, base: string) {
  const stem = base.slice(0, 56);
  let id = stem;
  for (let n = 2; ids.has(id) || !ID.test(id); n++) id = `${stem}-${n}`;
  ids.add(id);
  return id;
}

/** The modules switching `m` (naming `ref`) to its preset, or why it cannot. */
function switched(library: Library, m: Node, ref: string, ids: Set<string>, said: string[]): Node[] | string {
  const to = RETIRED[ref];
  if (!to) return `${ref} has no match in the library`;
  const preset = library.presets.get(to.preset), layers = preset?.layers;
  const chain = Array.isArray(layers) && layers.length === 1 && isNode(layers[0]) ? layers[0].modules : null;
  const parts = Array.isArray(chain) ? chain.filter(isNode) : [];
  if (!parts.length || parts.some((p) => !library.modules.has(text(p.ref, 64)))) {
    return `${ref}'s match, the ${to.preset} preset, is not in the library`;
  }
  const params = isNode(m.params) ? m.params : {};
  const kept = Object.entries(to.params).filter(([from]) => from in params);
  const id = typeof m.id === 'string' && ID.test(m.id) ? m.id : fresh(ids, 'm1');
  const made = parts.map((p, i) => {
    const entry = library.modules.get(p.ref as string)!;
    const own = isNode(p.params) ? p.params : {};
    const node: Node = { id: i ? fresh(ids, `${id}-${p.ref}`) : id, kind: entry.kind, title: entry.title,
      ref: p.ref, ...(m.code === undefined ? {} : { code: entry.code }),
      params: i ? { ...own } : { ...own, ...Object.fromEntries(kept.map(([from, name]) => [name, params[from]])) } };
    if (i) node.on = id;
    else for (const k of ['blend', 'as', 'enabled'] as const) if (k in m) node[k] = m[k];
    return node;
  });
  said.push(`${text(m.title) || ref} is now the ${text(preset!.title) || to.preset} preset (${parts.map((p) => p.ref)
    .join(', ')})${kept.length ? `, keeping ${kept.map(([from]) => from).join(', ')}` : ''}`);
  return made;
}

/** A layer's or sub-layer's chain: its modules, or for one that is a source naming a retired pattern, a chain of it
 * (`rest` the node without the source's fields); null when it has none to switch. */
function chainOf(node: Node, ids: Set<string>) {
  if (Array.isArray(node.modules)) return { modules: node.modules, rest: node };
  if (!retiredRef(node)) return null;
  const { code, params, ref, ...rest } = node, id = fresh(ids, 'm1');
  return { modules: [{ id, kind: 'source', title: node.title, ref, code, params }] as unknown[], rest };
}

/** `modules` (a chain) with its retired modules switched, composites' sub-layers' too; or why it cannot be. */
function switchChain(library: Library, modules: unknown[], ids: Set<string>, said: string[]): unknown[] | string {
  const out: unknown[] = [];
  for (const m of modules) {
    if (isNode(m) && m.kind === 'composite' && Array.isArray(m.layers)) {
      const layers: unknown[] = [];
      for (const sub of m.layers) {
        const own = isNode(sub) ? chainOf(sub, ids) : null, lines: string[] = [];
        const inner = own ? switchChain(library, own.modules, ids, lines) : null;
        if (typeof inner === 'string') return inner;
        said.push(...lines);
        layers.push(inner && lines.length ? { ...own!.rest, modules: inner } : sub);
      }
      out.push({ ...m, layers });
      continue;
    }
    const ref = isNode(m) ? retiredRef(m) : null;
    const made = ref ? switched(library, m as Node, ref, ids, said) : [m];
    if (typeof made === 'string') return made;
    out.push(...made);
  }
  return out.length > MAX_MODULES ? `the switch takes it past ${MAX_MODULES} modules` : out;
}

/** What a layer is called in what the step says. */
const layerName = (layer: unknown, i: number) => `Layer ${i + 1}${text(isNode(layer) ? layer.title : '')
  ? ` (${text((layer as Node).title)})` : ''}`;

/**
 * `layers` with each module naming a retired pattern switched to its match, and each layer holding one without a
 * match (or that a switch takes past the limit) dropped; `said`, a line for each layer switched or dropped. The
 * same array when none names one.
 */
export function switchRetired(library: Library, layers: unknown): { layers: unknown, said: string[] } {
  if (!Array.isArray(layers)) return { layers, said: [] };
  const out: unknown[] = [], said: string[] = [];
  for (const [i, layer] of layers.entries()) {
    if (!isNode(layer)) {
      out.push(layer);
      continue;
    }
    const ids = Array.isArray(layer.modules) ? idsOf(layer.modules) : new Set<string>();
    const own = chainOf(layer, ids);
    if (!own) {
      out.push(layer);
      continue;
    }
    const lines: string[] = [];
    const chain = switchChain(library, own.modules, ids, lines);
    if (typeof chain === 'string') said.push(`${layerName(layer, i)} dropped: ${chain}`);
    else if (lines.length) said.push(...lines.map((line) => `${layerName(layer, i)}: ${line}`));
    if (typeof chain !== 'string') out.push(lines.length ? { ...own.rest, modules: chain } : layer);
  }
  return said.length ? { layers: out, said } : { layers, said };
}
