// A stored module is its library `ref` and params (SPEC-looks "Modules"): reads fill each module's `code` from the
// library's current file, ignoring any code stored, and writes keep none. A module without a ref, or whose code is
// not its ref's, takes the ref of the one entry whose current or earlier file (history.json) its code is exactly. The
// library, hidden entries too, is read again at most every REFRESH_MS, so a list of looks costs one read of it.
import { readFileSync } from 'node:fs';

import type { LibraryEntry } from '../shared/schemas/rig.ts';
import { sha256 } from './library-history.ts';

const REFRESH_MS = 2000;
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

/** A look's layers and its versions' layers. */
function eachLayers(look: Node, visit: (layers: unknown) => void) {
  visit(look.layers);
  if (Array.isArray(look.versions)) for (const v of look.versions) if (isNode(v)) visit(v.layers);
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
  const each = (look: object, visit: (m: Node, lib: Files) => void) => {
    const lib = library();
    eachLayers(look as Node, (layers) => eachModule(layers, (m) => visit(m, lib)));
    return look;
  };
  return {
    /** `look` (changed in place) with every module's code its ref's current file ('' for a ref the library lacks). */
    read: <T extends object>(look: T): T => each(look, (m, lib) => {
      const ref = refOf(m, lib);
      if (typeof ref === 'string') m.ref = ref;
      m.code = (typeof ref === 'string' && lib.codes.get(ref)) || '';
    }) as T,
    /** `look` (changed in place) with each module's ref set and no code kept. */
    write: <T extends object>(look: T): T => each(look, (m, lib) => {
      const ref = refOf(m, lib);
      if (typeof ref === 'string') m.ref = ref;
      delete m.code;
    }) as T,
  };
}
