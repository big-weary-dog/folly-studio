// A chain as a tree (SPEC-library "Composites"): a composite's sub-layers hold chains of their own. Pure, and
// importing nothing, so the app takes it without the core.

type Node = { id?: string, kind?: string, on?: string, layers?: { modules: Node[] }[] };

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

/** The id of the source (or composite) whose attached run module j of `list` may join (SPEC-library "Attached
 * modules"): the module above it, past the run; null when that is not a source. */
export function attachedTo(list: readonly Node[], j: number) {
  let i = j - 1;
  while (i >= 0 && list[i].on) i--;
  return i >= 0 && (!list[i].kind || list[i].kind === 'source' || list[i].kind === 'composite')
    ? list[i].id ?? `m${i + 1}` : null;
}

/** The end (exclusive) of the run attached to module i of `list`. */
export function runEnd(list: readonly Node[], i: number) {
  let e = i + 1;
  while (e < list.length && list[e].on !== undefined && list[e].on === list[i].id) e++;
  return e;
}
