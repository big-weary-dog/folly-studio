// Only library patterns save (SPEC-looks "Modules"): a look saved, by hand or by an import, has each module name a
// library module by `ref` alone (no code), or carry a library pattern's current or earlier committed file exactly, by
// SHA-256 (history.json). An edited copy, or a ref the library lacks, is refused.
import { historicalLibrary, libraryFiles, sha256 } from './library-history.ts';
import type { Layer } from '../shared/schemas/look.ts';

/** The SHA-256 of each code file `dir`'s index.json lists (presets have none), and of its earlier copies
 * (history.json); none when it is missing. */
export async function libraryHashes(dir: string) {
  return new Set([...(await libraryFiles(dir)).values()].flatMap((f) => [...f.hashes]));
}

type Module = { title?: unknown, code?: unknown, kind?: unknown, layers?: unknown };
type Checked = { title?: unknown, code?: unknown, modules?: readonly Module[] };
const named = (v: unknown) => (typeof v === 'string' ? v.slice(0, 60) : '');

/** Where `layers` first has code that is not the library's ('' when none): a composite has no code of its own (one
 * with any is custom), so its sub-layers' modules are looked through, named as its layer. */
function custom(layers: readonly Checked[], library: ReadonlySet<string>, at = ''): string {
  for (const [i, layer] of layers.entries()) {
    const name = at || `Layer ${i + 1}${named(layer?.title) ? ` (${named(layer.title)})` : ''}`;
    const where = (m: Module) => (m !== layer && named(m?.title) ? `${name}'s ${named(m.title)}` : name);
    for (const m of Array.isArray(layer?.modules) ? layer.modules : [layer as Module]) {
      if (m?.kind === 'composite' && m !== layer) {
        if (m.code) return where(m);
        const inner = custom(Array.isArray(m.layers) ? m.layers : [], library, name);
        if (inner) return inner;
      } else if (typeof m?.code !== 'string' || !library.has(sha256(m.code))) {
        return where(m);
      }
    }
  }
  return '';
}

/** Why `layers` may not save ('' when each one's code is the library's, unchanged). */
export function customCode(layers: readonly Checked[], library: ReadonlySet<string>) {
  const what = custom(layers, library);
  return what ? `Only looks made of unchanged library patterns save; ${what} is custom code.` : '';
}

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

/** The check in front of saving: refuses(layers) → why the look cannot be saved ('' when it can), check() throws it. */
export function createCodeGate({ patternsDir }: { patternsDir: string }) {
  let files: ReturnType<typeof libraryFiles> | undefined;   // the library changes only with a deploy, which restarts
  const history = historicalLibrary(patternsDir);
  async function refuses(layers: unknown) {
    const lib = await (files ??= libraryFiles(patternsDir));
    const hashes = new Set([...lib.values()].flatMap((f) => [...f.hashes]));
    const checked = withRefCode(Array.isArray(layers) ? layers : [], lib) as Parameters<typeof customCode>[0];
    return customCode(checked, hashes);
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
