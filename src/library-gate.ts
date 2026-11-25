// Only library patterns save (spec/frames "Library only"): a look saved, by hand or by an import, has each module name
// a library module by `ref` (code it carries is dropped for the library's), or, with no ref the library has, carry a
// library pattern's current file exactly, by SHA-256. Other code, or a ref the library lacks, is refused.
import { eachModule, findModule, type Node } from '../shared/look-modules.ts';
import type { Layer } from '../shared/schemas/look.ts';
import { libraryFiles, sha256 } from './library-files.ts';

/** The SHA-256 of each module file `dir`'s index.json lists; none when it is missing. */
export async function libraryHashes(dir: string) {
  return new Set([...(await libraryFiles(dir)).modules.values()].map((f) => f.hash));
}

const named = (v: unknown) => (typeof v === 'string' ? v.slice(0, 60) : '');

/** Why `layers` may not save ('' when each module is the library's): the first module, by its layer, whose ref is
 * not one of `refs` and whose code is not a file `hashes` holds, or where the shape breaks. */
export function customCode(layers: unknown, hashes: ReadonlySet<string>, refs: ReadonlySet<string> = new Set()) {
  const library = (m: Node) => (typeof m.ref === 'string' && refs.has(m.ref))
    || (typeof m.code === 'string' && hashes.has(sha256(m.code)));
  const met = findModule(layers, (met) => met.fault || !library(met.module!));
  if (!met) return '';
  const name = `Layer ${met.at + 1}${named(met.layer?.title) ? ` (${named(met.layer!.title)})` : ''}`;
  const title = met.module && met.module !== met.layer ? named(met.module.title) : '';
  const what = title ? `${name}'s ${title}` : name;
  const ref = met.fault ? '' : named(met.module.ref);
  if (ref) return `${what} names ${ref}, which the library does not have.`;
  return `Only looks made of unchanged library patterns save; ${what} is custom code.`;
}

/** The check in front of saving: refuses(layers) → why the look cannot be saved ('' when it can), check() throws it;
 * upgrade(layers) gives each module its entry's current file, naming it as `ref`. */
export function createCodeGate({ patternsDir }: { patternsDir: string }) {
  let files: ReturnType<typeof libraryFiles> | undefined;   // the library changes only with a deploy, which restarts
  const library = () => (files ??= libraryFiles(patternsDir));
  async function refuses(layers: unknown) {
    const { modules } = await library();
    return customCode(layers, new Set([...modules.values()].map((f) => f.hash)), new Set(modules.keys()));
  }
  return {
    async upgrade(layers: Layer[]): Promise<Layer[]> {
      const { modules } = await library();
      const copy = structuredClone(layers);
      eachModule(copy, (m) => {
        if (typeof m.code !== 'string') return;
        const hash = sha256(m.code), byFile = [...modules].filter(([, f]) => f.hash === hash);
        const ref = typeof m.ref === 'string' && modules.has(m.ref) ? m.ref
          : byFile.length === 1 ? byFile[0]![0] : undefined;
        if (!ref) return;
        m.ref = ref;
        m.code = modules.get(ref)!.code;
      });
      return copy;
    },
    refuses,
    async check(layers: unknown, fail: (why: string) => Error) {
      const why = await refuses(layers);
      if (why) throw fail(why);
    },
  };
}
export type CodeGate = ReturnType<typeof createCodeGate>;
