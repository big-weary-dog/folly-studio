// The library's module files, by name and SHA-256 (SPEC-baking "Library only"), and its presets.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { isNode, type Node } from '../shared/look-modules.ts';

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export type LibraryModule = { code: string, hash: string, kind: string, title: string };
export type Library = { modules: Map<string, LibraryModule>, presets: Map<string, Node> };

const NAME = /^[a-z0-9-]{1,64}$/;

/** What `dir`'s index.json lists: each module (source, warp or filter) with its current file, and each preset; none
 * when the index is missing. With `strict` (what the library-only step reads), an index or listed file it cannot
 * read or parse throws rather than counting as none, as that would drop looks it holds. */
export async function libraryFiles(dir: string, { strict = false } = {}): Promise<Library> {
  const library: Library = { modules: new Map(), presets: new Map() };
  const index = await fs.readFile(path.join(dir, 'index.json'), 'utf8').then(JSON.parse, (err) => {
    if (strict && err.code !== 'ENOENT') throw err;
    return [];
  });
  for (const entry of Array.isArray(index) ? index : []) {
    if (!isNode(entry) || typeof entry.name !== 'string' || !NAME.test(entry.name)) continue;
    if (entry.kind === 'preset') {
      library.presets.set(entry.name, entry);
      continue;
    }
    const code = await fs.readFile(path.join(dir, `${entry.name}.js`), 'utf8').catch((err) => {
      if (strict) throw err;
      return null;
    });
    if (code === null) continue;
    const kind = typeof entry.kind === 'string' ? entry.kind : 'source';
    const title = typeof entry.title === 'string' ? entry.title : entry.name;
    library.modules.set(entry.name, { code, hash: sha256(code), kind, title });
  }
  return library;
}
