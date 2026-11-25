// The library-only rule for stored looks (SPEC-looks "Library only"): a module is library when its code is a current or
// earlier file of a library entry, retired ones too, the one its `ref` names, else the one whose file it is. A look or
// version with any other module is dropped; the rest move to the current library (a retired pattern's copy stays as
// it is), each module naming its entry.
import type { libraryFiles } from './library-history.ts';
import { sha256 } from './library-history.ts';

type Library = Awaited<ReturnType<typeof libraryFiles>>;
type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The entry `code` is a file of: `ref`'s when given (null when not its file), else the one whose file it is. */
function entryOf(library: Library, code: unknown, ref: unknown) {
  if (typeof code !== 'string') return null;
  const hash = sha256(code);
  if (typeof ref === 'string') return library.get(ref)?.hashes.has(hash) ? ref : null;
  const names = [...library].filter(([, f]) => f.hashes.has(hash)).map(([name]) => name);
  return names.length === 1 ? names[0]! : null;
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
  return ref ? { ...node, ref, code: library.get(ref)!.code ?? node.code } : null;
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

export type Dropped = { look: string, title: string, owner: string, version?: number };

/**
 * The looks under the rule: `looks` as kept (versions numbered, so dropping one renumbers none; `ideaId` gone),
 * `dropped` each look and version left out, `changed` how many kept looks differ from what was stored.
 */
export function libraryOnly(library: Library, stored: readonly Node[]) {
  const looks: Node[] = [], dropped: Dropped[] = [];
  let changed = 0;
  for (const look of stored) {
    const who = { look: text(look.id, 64), title: text(look.title), owner: text(look.owner, 64) };
    const layers = libraryLayers(library, look.layers);
    if (!layers) {
      dropped.push(who);
      continue;
    }
    const { ideaId: _, ...rest } = look;
    const out: Node = { ...rest, layers };
    if (Array.isArray(look.versions)) {
      out.versions = look.versions.flatMap((v: unknown, i) => {
        if (!isNode(v)) return [];
        const n = typeof v.n === 'number' ? v.n : i + 1;
        const kept = 'layers' in v ? libraryLayers(library, v.layers) : v.layers;
        if (!kept) {
          dropped.push({ ...who, version: n });
          return [];
        }
        return [{ ...v, n, ...('layers' in v ? { layers: kept } : {}) }];
      });
    }
    if (JSON.stringify(out) !== JSON.stringify(look)) changed++;
    looks.push(out);
  }
  return { looks, dropped, changed };
}

/** A user without `access`, the AI's grants (the same object when it had none). */
export function withoutAccess(user: Node) {
  if (!('access' in user)) return user;
  const { access: _, ...rest } = user;
  return rest;
}
