// A stored module is its library `ref` and params (SPEC-looks "Modules"): reads fill each module's `code` from the
// library's current file, ignoring any code stored, and writes keep none. A module whose ref the library lacks, or
// that has none, takes the ref of the one entry whose current file its code is exactly. The library, hidden entries too, is read again at most every REFRESH_MS, so a list of looks costs one read of it. A
// look or version keeps the hash of the code it was saved with (`codeHash`): when the library changes that code, a
// read leaves out the look's bake and review, and a version's review.
import { eachModule, isNode, moduleCodes, type Node } from '../shared/look-modules.ts';
import type { LibraryEntry } from '../shared/schemas/rig.ts';
import { sha256 } from './library-files.ts';

const REFRESH_MS = 2000;
// A module's first keys, as the look schema orders them: a bake's hash is of the layers' JSON, so a filled module's
// keys are in the order a saved one's are.
const FIRST = ['id', 'kind', 'title', 'ref', 'code'];

/** `m` (changed in place) with `ref` (when given) and `code`, its first keys in the look schema's order. */
function fill(m: Node, ref: unknown, code: string) {
  const was: Node = { ...m, ...(typeof ref === 'string' ? { ref } : {}), code };
  for (const k of Object.keys(m)) delete m[k];
  for (const k of FIRST) if (k in was) m[k] = was[k];
  for (const [k, v] of Object.entries(was)) if (!FIRST.includes(k)) m[k] = v;
}

/** A look's versions. */
const versionsOf = (look: Node) => (Array.isArray(look.versions) ? look.versions.filter(isNode) : []);

/** The hash of `layers`' module code, in order; null when any module has none (stored as its ref alone). */
function codeHash(layers: unknown) {
  const codes = moduleCodes(layers);
  return codes.every((c) => typeof c === 'string') ? sha256(JSON.stringify(codes)) : null;
}

type Files = { codes: Map<string, string>, names: Map<string, string | null> };

/** The library's current files by name, and which name each file's hash is (null: several). */
function files(loadLibrary: () => readonly LibraryEntry[]): Files {
  const codes = new Map<string, string>(), names = new Map<string, string | null>();
  const add = (hash: unknown, name: string) => {
    if (typeof hash !== 'string') return;
    const was = names.get(hash);
    names.set(hash, was === undefined || was === name ? name : null);
  };
  for (const e of loadLibrary()) {
    if (e.kind === 'preset') continue;
    codes.set(e.name, e.code);
    add(sha256(e.code), e.name);
  }
  return { codes, names };
}

export function libraryRefs(loadLibrary: () => readonly LibraryEntry[], now = () => Date.now()) {
  let lib: Files = { codes: new Map(), names: new Map() }, readAt = -Infinity;
  const library = () => {
    if (now() - readAt >= REFRESH_MS) [lib, readAt] = [files(loadLibrary), now()];
    return lib;
  };
  /** `m`'s ref: the one it names when the library has it, else the one its code is the file of. */
  const refOf = (m: Node, { codes, names }: Files) => {
    if (typeof m.code !== 'string' || (typeof m.ref === 'string' && codes.has(m.ref))) return m.ref;
    return names.get(sha256(m.code)) ?? m.ref;
  };
  const filled = (layers: unknown, lib: Files) => eachModule(layers, (m) => {
    const ref = refOf(m, lib);
    fill(m, ref, (typeof ref === 'string' && lib.codes.get(ref)) || '');
  });
  return {
    /** `look` (changed in place) with every module's code its ref's current file ('' for a ref the library lacks);
     * one whose code is not what it was saved with has no bake, and is not reviewed, nor is such a version. */
    read<T extends object>(doc: T): T {
      const look = doc as Node, lib = library();
      for (const node of [look, ...versionsOf(look)]) {
        const was = node.codeHash ?? codeHash(node.layers);
        delete node.codeHash;
        filled(node.layers, lib);
        if (was === null || was === codeHash(node.layers)) continue;
        if (node !== look) {
          if (node.reviewed) node.reviewed = false;
          continue;
        }
        for (const k of ['bake', 'reviewedBy', 'flashOverride']) delete look[k];
        if ('reviewed' in look) look.reviewed = false;
      }
      return doc;
    },
    /** `to` (changed in place), `from` with its modules converted (reordered), given the hash of the code `from` was
     * saved with (its stored hash, or its stored code's) in its new order; the old hash kept when the library has
     * changed that code since, and none when nothing says what it was. */
    carryHash(from: object, to: object) {
      const was = (from as Node).codeHash ?? codeHash((from as Node).layers), lib = library();
      if (typeof was !== 'string') {
        delete (to as Node).codeHash;
        return;
      }
      const now = (layers: unknown) => {
        const copy = structuredClone(layers);
        filled(copy, lib);
        return codeHash(copy);
      };
      (to as Node).codeHash = (was === now((from as Node).layers) && now((to as Node).layers)) || was;
    },
    /** `look` (changed in place) with each module's ref set and no code kept, it and each version with the hash of
     * the code it was saved with (`codeHash`), so a read knows when the library changed it. */
    write<T extends object>(doc: T): T {
      const look = doc as Node, lib = library();
      for (const node of [look, ...versionsOf(look)]) node.codeHash = codeHash(node.layers) ?? node.codeHash;
      for (const layers of [look.layers, ...versionsOf(look).map((v) => v.layers)]) {
        eachModule(layers, (m) => {
          const ref = refOf(m, lib);
          if (typeof ref === 'string') m.ref = ref;
          delete m.code;
        });
      }
      return doc;
    },
  };
}
