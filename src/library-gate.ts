// Only library patterns save (spec/frames "Library only"): a look saved, by hand or by an import, has each module name
// a library module by `ref`, and plays that module's current file. A ref the library lacks is refused.
import { findModule } from '../shared/look-modules.ts';
import type { LibraryEntry } from '../shared/schemas/rig.ts';

const named = (v: unknown) => (typeof v === 'string' ? v.slice(0, 60) : '');

/** Why `layers` may not save ('' when each module names one of `refs`): the first module, by its layer, that names
 * none of them, or where the shape breaks. */
export function unknownRef(layers: unknown, refs: ReadonlySet<string>) {
  const met = findModule(layers, (met) => met.fault || !(typeof met.module.ref === 'string'
    && refs.has(met.module.ref)));
  if (!met) return '';
  const name = `Layer ${met.at + 1}${named(met.layer?.title) ? ` (${named(met.layer!.title)})` : ''}`;
  const title = met.module && met.module !== met.layer ? named(met.module.title) : '';
  const what = title ? `${name}'s ${title}` : name;
  const ref = met.fault ? '' : named(met.module.ref);
  if (ref) return `${what} names ${ref}, which the library does not have.`;
  return `Only looks made of library patterns save; ${what} names none.`;
}

/** The check in front of saving: check(layers, fail) throws fail(why) when a module names no library module (the
 * loader's, src/static.ts). */
export function createCodeGate(loadLibrary: () => readonly LibraryEntry[]) {
  return {
    async check(layers: unknown, fail: (why: string) => Error) {
      const refs = new Set(loadLibrary().flatMap((e) => (e.kind === 'preset' ? [] : [e.name])));
      const why = unknownRef(layers, refs);
      if (why) throw fail(why);
    },
  };
}
export type CodeGate = ReturnType<typeof createCodeGate>;
