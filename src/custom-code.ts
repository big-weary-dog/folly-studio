// Custom code is off (SPEC-baking "Custom code"): a look saved, by hand, by an import or by a generator, carries only
// library code, a library pattern's current or historical file exactly (src/box-library.ts).
import { customCode, libraryHashes } from './box-library.ts';
import { historicalLibrary } from './library-history.ts';
import type { Layer } from '../shared/schemas/look.ts';

/**
 * The check in front of saving: refuses(layers) → why the look cannot be saved ('' when it can), check() throws it;
 * open() whether custom code is on (tests only: `on`); allows() → a test of one piece of code, for a generator's
 * rounds.
 */
export function createCodeGate({ on, patternsDir }: { on: () => boolean, patternsDir: string }) {
  let hashes: Promise<Set<string>> | undefined;   // the library changes only with a deploy, which restarts
  const history = historicalLibrary(patternsDir);
  const library = () => (hashes ??= libraryHashes(patternsDir));
  async function refuses(layers: unknown) {
    return on() ? '' : customCode(Array.isArray(layers) ? layers : [], await library());
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
    async allows(): Promise<(code: string) => boolean> {
      if (on()) return () => true;
      const lib = await library();
      return (code) => !customCode([{ code }], lib);
    },
  };
}
export type CodeGate = ReturnType<typeof createCodeGate>;
