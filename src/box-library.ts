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

type Layer = { title?: unknown, code?: unknown, modules?: readonly { title?: unknown, code?: unknown }[] };

/** Why the box without bubblewrap refuses `layers` ('' when each one's code is the library's, unchanged). */
export function customCode(layers: readonly Layer[], library: ReadonlySet<string>) {
  for (const [i, layer] of layers.entries()) {
    const title = typeof layer?.title === 'string' ? layer.title.slice(0, 60) : '';
    const name = `Layer ${i + 1}${title ? ` (${title})` : ''}`;
    const parts = Array.isArray(layer?.modules) ? layer.modules : [layer];
    const bad = parts.find((m) => typeof m?.code !== 'string' || !library.has(sha256(m.code)));
    if (!bad) continue;
    const what = bad !== layer && typeof bad?.title === 'string' && bad.title ? `${name}'s ${bad.title.slice(0, 60)}`
      : name;
    return 'This server bakes without bubblewrap, so only looks made of unchanged library patterns; '
      + `${what} is custom code.`;
  }
  return '';
}
