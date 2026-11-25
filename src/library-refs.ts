// A stored module is its library `ref` and params (SPEC-looks "Modules"): reads fill each module's `code` from the
// library's current file, ignoring any code stored, and writes keep none. A module without a ref, or whose code is
// not its ref's, takes the ref of the one entry whose current or earlier file (history.json) its code is exactly. The
// library, hidden entries too, is read again at most every REFRESH_MS, so a list of looks costs one read of it. A
// look or version keeps the hash of the code it was saved with (`codeHash`): when the library changes that code, a
// read leaves out the look's bake and review, and a version's review.
import { readFileSync } from 'node:fs';

import type { LibraryEntry } from '../shared/schemas/rig.ts';
import { sha256 } from './library-history.ts';

const REFRESH_MS = 2000;
// A module's first keys, as the look schema orders them: a bake's hash is of the layers' JSON, so a filled module's
// keys are in the order a saved one's are.
const FIRST = ['id', 'kind', 'title', 'ref', 'code'];
type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => !!v && typeof v === 'object' && !Array.isArray(v);

/** Each module of `layers` (a layer that is one source too; composites' sub-layers' too) given to `visit`. */
function eachModule(layers: unknown, visit: (m: Node) => void) {
  if (!Array.isArray(layers)) return;
  for (const layer of layers) {
    if (!isNode(layer)) continue;
    if (!Array.isArray(layer.modules)) {
      visit(layer);
      continue;
    }
    for (const m of layer.modules) {
      if (!isNode(m)) continue;
      if (m.kind === 'composite') eachModule(m.layers, visit);
      else visit(m);
    }
  }
}

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
  const codes: unknown[] = [];
  eachModule(layers, (m) => codes.push(m.code));
  return codes.every((c) => typeof c === 'string') ? sha256(JSON.stringify(codes)) : null;
}

type Files = { codes: Map<string, string>, names: Map<string, string | null> };

/** The library's current files by name, and which name each file's hash (current or earlier) is (null: several). */
function files(loadLibrary: () => readonly LibraryEntry[], historyFile: string): Files {
  let history: Record<string, unknown> = {};
  try { history = JSON.parse(readFileSync(historyFile, 'utf8')) ?? {}; } catch { /* no history */ }
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
    const earlier = history[e.name];
    if (Array.isArray(earlier)) for (const hash of earlier) add(hash, e.name);
  }
  return { codes, names };
}

export function libraryRefs(loadLibrary: () => readonly LibraryEntry[], historyFile: string, now = () => Date.now()) {
  let lib: Files = { codes: new Map(), names: new Map() }, readAt = -Infinity;
  const library = () => {
    if (now() - readAt >= REFRESH_MS) [lib, readAt] = [files(loadLibrary, historyFile), now()];
    return lib;
  };
  /** `m`'s ref: the one its code is a file of when it is not its own ref's, else the one it names. */
  const refOf = (m: Node, { codes, names }: Files) => {
    if (typeof m.code !== 'string' || (typeof m.ref === 'string' && codes.get(m.ref) === m.code)) return m.ref;
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
