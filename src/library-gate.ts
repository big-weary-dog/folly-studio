// Only library patterns save (SPEC-looks "Modules"): a look saved, by hand or by an import, has each module name a
// library module by `ref` alone (no code), or carry a library pattern's current or earlier committed file exactly, by
// SHA-256 (history.json). An edited copy, or a ref the library lacks, is refused.
import { findModule, type Node } from '../shared/look-modules.ts';
import type { Layer } from '../shared/schemas/look.ts';
import { historicalLibrary, libraryFiles, sha256 } from './library-history.ts';

/** The SHA-256 of each code file `dir`'s index.json lists (presets have none), and of its earlier copies
 * (history.json); none when it is missing. */
export async function libraryHashes(dir: string) {
  return new Set([...(await libraryFiles(dir)).values()].flatMap((f) => [...f.hashes]));
}

const named = (v: unknown) => (typeof v === 'string' ? v.slice(0, 60) : '');

/** Why `layers` may not save ('' when each one's code is the library's, unchanged): the first module, by its layer,
 * whose code is not a file `hashes` holds, nor (with none) its ref one of `refs`, or where the shape breaks. */
export function customCode(layers: unknown, hashes: ReadonlySet<string>, refs: ReadonlySet<string> = new Set()) {
  const library = (m: Node) => (typeof m.code === 'string' && hashes.has(sha256(m.code)))
    || (!m.code && typeof m.ref === 'string' && refs.has(m.ref));
  const met = findModule(layers, (met) => met.fault || !library(met.module!));
  if (!met) return '';
  const name = `Layer ${met.at + 1}${named(met.layer?.title) ? ` (${named(met.layer!.title)})` : ''}`;
  const title = met.module && met.module !== met.layer ? named(met.module.title) : '';
  const what = title ? `${name}'s ${title}` : name;
  return `Only looks made of unchanged library patterns save; ${what} is custom code.`;
}

/** The check in front of saving: refuses(layers) → why the look cannot be saved ('' when it can), check() throws it. */
export function createCodeGate({ patternsDir }: { patternsDir: string }) {
  let files: ReturnType<typeof libraryFiles> | undefined;   // the library changes only with a deploy, which restarts
  const history = historicalLibrary(patternsDir);
  async function refuses(layers: unknown) {
    const lib = await (files ??= libraryFiles(patternsDir));
    return customCode(layers, new Set([...lib.values()].flatMap((f) => [...f.hashes])), new Set(lib.keys()));
  }
  return {
    async upgrade(layers: Layer[]) { return (await history).upgrade(layers); },
    refuses,
    async check(layers: unknown, fail: (why: string) => Error) {
      const why = await refuses(layers);
      if (why) throw fail(why);
    },
  };
}
export type CodeGate = ReturnType<typeof createCodeGate>;
