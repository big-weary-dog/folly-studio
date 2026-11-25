// What may save and bake (SPEC-baking "Custom code"): looks whose every layer's and module's code is a library
// pattern's current or earlier committed file exactly, by SHA-256. Those are our own code; anything else is refused.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { historicalLibrary } from './library-history.ts';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** The SHA-256 of each code file `dir`'s index.json lists (presets have none), and of its earlier copies
 * (history.json); none when it is missing. */
export async function libraryHashes(dir: string) {
  const index = await fs.readFile(path.join(dir, 'index.json'), 'utf8').then(JSON.parse, () => []);
  const names = (Array.isArray(index) ? index : []).filter((e) => e && e.kind !== 'preset'
    && /^[a-z0-9-]{1,64}$/.test(e.name)).map((e) => e.name as string);
  const codes = await Promise.all(names.map((n) => fs.readFile(path.join(dir, `${n}.js`), 'utf8').catch(() => null)));
  const hashes = new Set(codes.flatMap((c) => (c === null ? [] : [sha256(c)])));
  for (const hash of (await historicalLibrary(dir)).hashes) hashes.add(hash);
  return hashes;
}

type Module = { title?: unknown, code?: unknown, kind?: unknown, layers?: unknown };
type Layer = { title?: unknown, code?: unknown, modules?: readonly Module[] };
const named = (v: unknown) => (typeof v === 'string' ? v.slice(0, 60) : '');

/** Where `layers` first has code that is not the library's ('' when none): a composite has no code of its own (one
 * with any is custom), so its sub-layers' modules are looked through, named as its layer. */
function custom(layers: readonly Layer[], library: ReadonlySet<string>, at = ''): string {
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

/** Why `layers` may not save or bake ('' when each one's code is the library's, unchanged). */
export function customCode(layers: readonly Layer[], library: ReadonlySet<string>) {
  const what = custom(layers, library);
  return what ? `Only looks made of unchanged library patterns save and bake; ${what} is custom code.` : '';
}
