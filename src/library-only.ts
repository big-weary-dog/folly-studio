// The library-only rule for stored looks (spec/looks "Library only"): a module is library when its `ref` names a module
// the index lists, else when its code is the current file of one. Modules naming a retired pattern switch to its
// match first, a layer without one dropped; a look or version with any other module is dropped, saying why; the rest
// move to the current library, each module naming its entry.
import { compositeCode, eachModule, findModule, isNode, mapModules, moduleCodes, type Node }
  from '../shared/look-modules.ts';
import { layersHash, renderFields } from './bake.ts';
import { type Library, sha256 } from './library-files.ts';
import { switchRetired } from './retired-patterns.ts';

const text = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The entry a module is: the one `ref` names when the library has it, else the one whose current file `code` is
 * (null: none, or several). */
function entryOf(library: Library, code: unknown, ref: unknown) {
  if (typeof ref === 'string' && library.modules.has(ref)) return ref;
  if (typeof code !== 'string') return null;
  const hash = sha256(code);
  const names = [...library.modules].filter(([, f]) => f.hash === hash).map(([name]) => name);
  return names.length === 1 ? names[0]! : null;
}

/** Why `layers` are not library: the first module that is not, or where the shape breaks. */
export function whyNot(library: Library, layers: unknown): string {
  let why = '';
  findModule(layers, ({ module: m, fault }) => {
    if (fault) why = fault === 'composite' && compositeCode(m!) ? 'a composite with code' : `a malformed ${fault}`;
    else if (!entryOf(library, m.code, m.ref)) {
      why = typeof m.ref === 'string' && typeof m.code !== 'string' ? `${text(m.ref)}, which the library does not have`
        : `custom code (${text(m.title) || text(m.ref) || 'a module'})`;
    }
    return why;
  });
  return why;
}

/** Each module of `layers` whose stored code is not its entry's current file: an edited or earlier copy. */
function editedCopies(library: Library, layers: unknown) {
  const copies: string[] = [];
  eachModule(layers, (m) => {
    const ref = entryOf(library, m.code, m.ref);
    if (ref && typeof m.code === 'string' && m.code !== library.modules.get(ref)!.code) {
      copies.push(`${text(m.title) || ref} (${ref})`);
    }
  });
  return copies;
}

/** `m` on the current library, or null when its code is not the library's. */
function moved(library: Library, m: Node): Node | null {
  const ref = entryOf(library, m.code, m.ref);
  if (!ref) return null;
  return m.code === undefined ? { ...m, ref } : { ...m, ref, code: library.modules.get(ref)!.code };
}

/** `layers` on the current library, or null when any is not library code. */
export const libraryLayers = (library: Library, layers: unknown) => mapModules(layers, (m) => moved(library, m));

export type Dropped = { look: string, title: string, owner: string, version?: number, why: string };
/** A kept look or version changed: each layer `switched` (or dropped) and why, and its `edited` copies. */
export type Changed = { look: string, title: string, owner: string, version?: number, switched: string[],
  edited: string[] };

const hashOf = (look: Node) => layersHash(renderFields(look as Parameters<typeof renderFields>[0]));
const plays = (a: unknown, b: unknown) => JSON.stringify(moduleCodes(a)) !== JSON.stringify(moduleCodes(b));

/**
 * The looks under the rule: `looks` as kept (versions numbered, and the look's own number written, so dropping one
 * renumbers none; `ideaId` gone), `dropped` each look and version left out, `changes` each kept one switched off a
 * retired pattern or holding edited copies, `changed` how many kept looks differ from what was stored, `rebaked` the
 * kept looks whose code changed: their bake and review no longer hold, so both go, and a version whose code changed
 * loses its review.
 */
export function libraryOnly(library: Library, stored: readonly Node[]) {
  const looks: Node[] = [], dropped: Dropped[] = [], changes: Changed[] = [], rebaked: string[] = [];
  let changed = 0;
  /** `layers` switched off retired patterns and on the current library (null: not library), noting what changed. */
  const rule = (who: Omit<Changed, 'switched' | 'edited'>, stored: unknown) => {
    const { layers: off, said } = switchRetired(library, stored);
    const layers = libraryLayers(library, off);
    if (!layers) return { layers, off, said };
    const edited = editedCopies(library, off);
    if (said.length || edited.length) changes.push({ ...who, switched: said, edited });
    return { layers, off, said };
  };
  for (const look of stored) {
    const who = { look: text(look.id, 64), title: text(look.title), owner: text(look.owner, 64) };
    const { layers, off, said } = rule(who, look.layers);
    if (!layers) {
      dropped.push({ ...who, why: whyNot(library, off) });
      continue;
    }
    const { ideaId: _, ...rest } = look;
    let out: Node = { ...rest, layers };
    if (said.length || plays(look.layers, layers)) {
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
        if (!('layers' in v)) return [v];
        const { layers: kept, off: vOff, said: vSaid } = rule({ ...who, version: v.n as number }, v.layers);
        if (!kept) {
          dropped.push({ ...who, version: v.n as number, why: whyNot(library, vOff) });
          return [];
        }
        const { reviewed: _r, ...plain } = v;
        return [{ ...(vSaid.length || plays(v.layers, kept) ? plain : v), layers: kept }];
      });
    }
    if (JSON.stringify(out) !== JSON.stringify(look)) changed++;
    looks.push(out);
  }
  return { looks, dropped, changes, changed, rebaked };
}

/** A user without `access`, the AI's grants (the same object when it had none). */
export function withoutAccess(user: Node) {
  if (!('access' in user)) return user;
  const { access: _, ...rest } = user;
  return rest;
}
