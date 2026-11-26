// The one walk over a look's modules (spec/looks "Modules"): every rule on them (the save check, code filled from
// refs, a bake's key) goes through it, so a new one lands in one place. It meets each module that runs code, in
// order: a chain's, and a composite's sub-layers' at any depth, a sub-layer read as a layer. A composite runs none of
// its own (spec/library "Composites"): one with code, or without sub-layers, breaks the shape, as does a layer
// without a chain or an entry that is not an object.
export type Node = Record<string, unknown>;
export const isNode = (v: unknown): v is Node => !!v && typeof v === 'object' && !Array.isArray(v);

/** What the walk meets: a `module` that runs code, or a `fault` where the shape breaks (a broken composite's
 * sub-layers are still walked); `at` is the index of the look's layer it sits in, `layer` that layer. */
type Met = { module: Node, fault?: undefined, layer: Node, at: number }
  | { module?: Node, fault: 'layer' | 'module' | 'composite', layer?: Node, at: number };

/** A composite (a chain's module of that kind) holds sub-layers, and its own code is '' or absent. */
const isComposite = (m: Node) => m.kind === 'composite';
const brokenComposite = (m: Node) => (m.code !== undefined && m.code !== '') || !Array.isArray(m.layers)
  || !m.layers.length;

/** Each thing met in `layers`, in order, given to `visit` until it returns true; the one it stopped at. */
export function findModule(layers: unknown, visit: (met: Met) => unknown): Met | undefined {
  const top = Array.isArray(layers) ? layers : [];
  for (const [at, layer] of top.entries()) {
    const met: Met | undefined = isNode(layer) ? chain(layer, layer, at, visit) : { fault: 'layer', at };
    if (met && (isNode(layer) || visit(met))) return met;
  }
  return undefined;
}

/** The walk of one layer or sub-layer (`node`), inside the look's layer `layer`. */
function chain(node: Node, layer: Node, at: number, visit: (met: Met) => unknown): Met | undefined {
  const meet = (met: Met) => (visit(met) ? met : undefined);
  if (!Array.isArray(node.modules)) return meet({ fault: 'layer', layer, at });
  for (const m of node.modules) {
    if (!isNode(m)) {
      const met = meet({ fault: 'module', layer, at });
      if (met) return met;
      continue;
    }
    if (!isComposite(m)) {
      const met = meet({ module: m, layer, at });
      if (met) return met;
      continue;
    }
    const met = brokenComposite(m) ? meet({ module: m, fault: 'composite', layer, at }) : undefined;
    if (met) return met;
    for (const sub of Array.isArray(m.layers) ? m.layers : []) {
      const inner = isNode(sub) ? chain(sub, layer, at, visit) : meet({ fault: 'module', layer, at });
      if (inner) return inner;
    }
  }
  return undefined;
}

/** Each module of `layers` that runs code, in order, given to `visit`; where the shape breaks is passed over. */
export function eachModule(layers: unknown, visit: (m: Node) => void) {
  findModule(layers, (met) => {
    if (!met.fault) visit(met.module);
  });
}

/** Each module's code in `layers`, in order: what plays changes when any does. */
export function moduleCodes(layers: unknown): unknown[] {
  const codes: unknown[] = [];
  eachModule(layers, (m) => codes.push(m.code));
  return codes;
}
