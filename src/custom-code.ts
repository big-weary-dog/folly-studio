// Custom code is off (SPEC-baking "Custom code"): a look saved, by hand or by an import, carries only library code:
// each module names a library module by `ref` alone (no code), or its code is a library pattern's current or
// historical file exactly (src/box-library.ts).
import { customCode } from './box-library.ts';
import { historicalLibrary, libraryFiles } from './library-history.ts';
import type { Layer } from '../shared/schemas/look.ts';

type Node = Record<string, unknown>;
/** `layers` with a module that has no code (a `ref` alone) given its ref's library file to check, when it has one. */
function withRefCode(layers: unknown[], lib: Map<string, { code: string | null }>): unknown[] {
  const one = (m: unknown): unknown => {
    if (!m || typeof m !== 'object') return m;
    const n = m as Node;
    if (Array.isArray(n.layers)) return { ...n, layers: withRefCode(n.layers, lib) };
    if (Array.isArray(n.modules)) return { ...n, modules: n.modules.map(one) };
    const code = !n.code && typeof n.ref === 'string' ? lib.get(n.ref)?.code : null;
    return code ? { ...n, code } : n;
  };
  return layers.map(one);
}

/**
 * The check in front of saving: refuses(layers) → why the look cannot be saved ('' when it can), check() throws it;
 * open() whether custom code is on (tests only: `on`).
 */
export function createCodeGate({ on, patternsDir }: { on: () => boolean, patternsDir: string }) {
  let files: ReturnType<typeof libraryFiles> | undefined;   // the library changes only with a deploy, which restarts
  const history = historicalLibrary(patternsDir);
  async function refuses(layers: unknown) {
    if (on()) return '';
    const lib = await (files ??= libraryFiles(patternsDir));
    const hashes = new Set([...lib.values()].flatMap((f) => [...f.hashes]));
    const checked = withRefCode(Array.isArray(layers) ? layers : [], lib) as Parameters<typeof customCode>[0];
    return customCode(checked, hashes);
  }
  return {
    /** Whether looks may take code that is not the library's. */
    open: on,
    async upgrade(layers: Layer[]) { return (await history).upgrade(layers); },
    refuses,
    async check(layers: unknown, fail: (why: string) => Error) {
      const why = await refuses(layers);
      if (why) throw fail(why);
    },
  };
}
export type CodeGate = ReturnType<typeof createCodeGate>;
