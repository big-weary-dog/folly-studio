// A chain as a tree (SPEC-library "Composites"): a composite's sub-layers hold chains of their own. Pure, and
// importing nothing, so the app takes it without the core.

type Node = { id?: string, kind?: string, layers?: { modules: Node[] }[] };

/** Every module of a chain, depth first: a composite, then its sub-layers' modules in order. */
export function flatModules<T extends Node>(modules: readonly T[], out: T[] = []): T[] {
  for (const m of modules) {
    out.push(m);
    if (m.layers) for (const s of m.layers) flatModules(s.modules as T[], out);
  }
  return out;
}

/** The chain with module `id` (wherever it sits) replaced by fn(it); the same arrays where nothing changed. */
export function mapModule<T extends Node>(modules: T[], id: string, fn: (m: T) => T): T[] {
  let changed = false;
  const next = modules.map((m) => {
    if (m.id === id) { changed = true; return fn(m); }
    if (!m.layers) return m;
    const layers = m.layers.map((s) => {
      const inner = mapModule(s.modules as T[], id, fn);
      return inner === s.modules ? s : { ...s, modules: inner };
    });
    if (layers.every((s, i) => s === m.layers![i])) return m;
    changed = true;
    return { ...m, layers };
  });
  return changed ? next : modules;
}

/** The chain with every module, a composite's sub-layers' too, as fn(it). */
export function mapEvery<T extends Node>(modules: readonly T[], fn: (m: T) => T): T[] {
  return modules.map((m) => {
    const n = fn(m);
    return n.layers ? { ...n, layers: n.layers.map((s) => ({ ...s, modules: mapEvery(s.modules as T[], fn) })) } : n;
  });
}
