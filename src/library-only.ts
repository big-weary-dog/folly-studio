// The library-only rule for stored looks (SPEC-looks "Library only"): a module is library when its code is a current or
// earlier file of a module the index lists (hidden ones too), the one its `ref` names, else the one whose file it is.
// A look or version with any other module is dropped, saying why (a retired pattern's copy names it); the rest move
// to the current library, each module naming its entry.
import { layersHash, renderFields } from './bake.ts';
import type { libraryFiles } from './library-history.ts';
import { sha256 } from './library-history.ts';

type Library = Awaited<ReturnType<typeof libraryFiles>>;
type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The entry `code` is a file of: `ref`'s when it is, else the one whose file it is (null: none, or several); a
 * retired one (no current file) too. Without code (stored as a ref alone), the entry `ref` names. */
function entryOf(library: Library, code: unknown, ref: unknown) {
  if (code === undefined) return typeof ref === 'string' && library.has(ref) ? ref : null;
  if (typeof code !== 'string') return null;
  const hash = sha256(code);
  if (typeof ref === 'string' && library.get(ref)?.hashes.has(hash)) return ref;
  const names = [...library].filter(([, f]) => f.hashes.has(hash)).map(([name]) => name);
  return names.length === 1 ? names[0]! : null;
}
const isLibrary = (library: Library, ref: string | null): ref is string => !!ref && library.get(ref)!.code !== null;

/** Why `layers` are not library: the first module that is not, a retired pattern's copy named. */
export function whyNot(library: Library, layers: unknown): string {
  for (const layer of Array.isArray(layers) ? layers : []) {
    if (!isNode(layer)) return 'a malformed layer';
    for (const m of Array.isArray(layer.modules) ? layer.modules : [layer]) {
      if (!isNode(m)) return 'a malformed module';
      if (m.kind === 'composite') {
        const inner = m.code ? 'a composite with code' : whyNot(library, m.layers);
        if (inner) return inner;
        continue;
      }
      const ref = entryOf(library, m.code, m.ref);
      if (ref && !isLibrary(library, ref)) return `retired pattern ${ref}`;
      if (!ref) return `custom code (${text(m.title) || text(m.ref) || 'a module'})`;
    }
  }
  return '';
}

/** `node` (a module, or a layer that is one source) on the current library, or null when its code is not the
 * library's; a composite has no code and its sub-layers' modules are looked through. */
function moved(library: Library, node: Node): Node | null {
  if (node.kind === 'composite') {
    if (node.code || !Array.isArray(node.layers)) return null;
    const layers = node.layers.map((sub) => (isNode(sub) ? chain(library, sub) : null));
    return layers.every(Boolean) ? { ...node, layers } : null;
  }
  const ref = entryOf(library, node.code, node.ref);
  if (!isLibrary(library, ref)) return null;
  return node.code === undefined ? { ...node, ref } : { ...node, ref, code: library.get(ref)!.code };
}

/** A layer (or a composite's sub-layer) on the current library, or null. */
function chain(library: Library, layer: Node): Node | null {
  if (!Array.isArray(layer.modules)) return moved(library, layer);
  const modules = layer.modules.map((m) => (isNode(m) ? moved(library, m) : null));
  return modules.every(Boolean) ? { ...layer, modules } : null;
}

/** `layers` on the current library, or null when any is not library code. */
export function libraryLayers(library: Library, layers: unknown): Node[] | null {
  if (!Array.isArray(layers)) return null;
  const out = layers.map((l) => (isNode(l) ? chain(library, l) : null));
  return out.every(Boolean) ? out as Node[] : null;
}

export type Dropped = { look: string, title: string, owner: string, version?: number, why: string };

/** Every module's code in `layers`, in order: what changes when a module moves to the current library. */
function codes(layers: unknown): unknown[] {
  if (!Array.isArray(layers)) return [];
  const one = (m: unknown) => (isNode(m) && Array.isArray(m.layers) ? codes(m.layers) : [isNode(m) ? m.code : null]);
  return layers.flatMap((l) => (!isNode(l) ? [] : Array.isArray(l.modules) ? l.modules.flatMap(one) : [l.code]));
}
const hashOf = (look: Node) => layersHash(renderFields(look as Parameters<typeof renderFields>[0]));
const plays = (a: unknown, b: unknown) => JSON.stringify(codes(a)) !== JSON.stringify(codes(b));

/**
 * The looks under the rule: `looks` as kept (versions numbered, and the look's own number written, so dropping one
 * renumbers none; `ideaId` gone), `dropped` each look and version left out, `changed` how many kept looks differ
 * from what was stored, `rebaked` the kept looks whose code changed: their bake and review no longer hold, so both
 * go, and a version whose code changed loses its review.
 */
export function libraryOnly(library: Library, stored: readonly Node[]) {
  const looks: Node[] = [], dropped: Dropped[] = [], rebaked: string[] = [];
  let changed = 0;
  for (const look of stored) {
    const who = { look: text(look.id, 64), title: text(look.title), owner: text(look.owner, 64) };
    const layers = libraryLayers(library, look.layers);
    if (!layers) {
      dropped.push({ ...who, why: whyNot(library, look.layers) });
      continue;
    }
    const { ideaId: _, ...rest } = look;
    let out: Node = { ...rest, layers };
    if (plays(look.layers, layers)) {
      const { bake: _b, reviewedBy: _r, flashOverride: _f, ...fresh } = out;
      out = { ...fresh, reviewed: false };
      rebaked.push(who.look);
    } else if (isNode(look.bake) && look.bake.layersHash === hashOf(look)) {
      out.bake = { ...look.bake, layersHash: hashOf(out) }; // refs named: the same frames, so the bake holds
    }
    if (Array.isArray(look.versions)) {
      const numbered = look.versions.map((v: unknown, i): Node | null => (isNode(v)
        ? { ...v, n: typeof v.n === 'number' ? v.n : i + 1 } : null));
      const last = numbered.at(-1)?.n;
      if (!isNode(look.version) && typeof last === 'number') out.version = { n: last + 1 };
      out.versions = numbered.flatMap((v) => {
        if (!v) return [];
        const kept = 'layers' in v ? libraryLayers(library, v.layers) : v.layers;
        if (!kept) {
          dropped.push({ ...who, version: v.n as number, why: whyNot(library, v.layers) });
          return [];
        }
        if (!('layers' in v)) return [v];
        const { reviewed: _r, ...plain } = v;
        return [{ ...(plays(v.layers, kept) ? plain : v), layers: kept }];
      });
    }
    if (JSON.stringify(out) !== JSON.stringify(look)) changed++;
    looks.push(out);
  }
  return { looks, dropped, changed, rebaked };
}

/** A user without `access`, the AI's grants (the same object when it had none). */
export function withoutAccess(user: Node) {
  if (!('access' in user)) return user;
  const { access: _, ...rest } = user;
  return rest;
}
