// What the render box may bake without bubblewrap (SPEC "Baked frames", "Library only"): looks whose every layer's
// and module's code is a library pattern's file exactly, by SHA-256. Those are our own code; anything else is refused.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** The SHA-256 of each code file `dir`'s index.json lists (presets have none); none when it is missing. */
export async function libraryHashes(dir: string) {
  const index = await fs.readFile(path.join(dir, 'index.json'), 'utf8').then(JSON.parse, () => []);
  const names = (Array.isArray(index) ? index : []).filter((e) => e && e.kind !== 'preset'
    && /^[a-z0-9-]{1,64}$/.test(e.name)).map((e) => e.name as string);
  const codes = await Promise.all(names.map((n) => fs.readFile(path.join(dir, `${n}.js`), 'utf8').catch(() => null)));
  return new Set(codes.flatMap((c) => (c === null ? [] : [sha256(c)])));
}

type Module = { title?: unknown, code?: unknown, kind?: unknown, layers?: unknown };
type Layer = { title?: unknown, code?: unknown, modules?: readonly Module[] };
const named = (v: unknown) => (typeof v === 'string' ? v.slice(0, 60) : '');

/** Where `layers` first has code that is not the library's ('' when none): a composite has none of its own, so its
 * sub-layers' modules are looked through, named as its layer. */
function custom(layers: readonly Layer[], library: ReadonlySet<string>, at = ''): string {
  for (const [i, layer] of layers.entries()) {
    const name = at || `Layer ${i + 1}${named(layer?.title) ? ` (${named(layer.title)})` : ''}`;
    for (const m of Array.isArray(layer?.modules) ? layer.modules : [layer as Module]) {
      if (m?.kind === 'composite' && Array.isArray(m.layers) && !m.code && Array.isArray(layer?.modules)) {
        const inner = custom(m.layers, library, name);
        if (inner) return inner;
      } else if (typeof m?.code !== 'string' || !library.has(sha256(m.code))) {
        return m !== layer && named(m?.title) ? `${name}'s ${named(m.title)}` : name;
      }
    }
  }
  return '';
}

/** Why the box without bubblewrap refuses `layers` ('' when each one's code is the library's, unchanged). */
export function customCode(layers: readonly Layer[], library: ReadonlySet<string>) {
  const what = custom(layers, library);
  return what ? 'This server bakes without bubblewrap, so only looks made of unchanged library patterns; '
    + `${what} is custom code.` : '';
}
