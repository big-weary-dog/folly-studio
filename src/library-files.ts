// The library's module files by name (spec/frames "Library only"), and the SHA-256 that keys code by its text.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { isNode } from '../shared/look-modules.ts';

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export type Library = { modules: Map<string, string> };

const NAME = /^[a-z0-9-]{1,64}$/;

/** What `dir`'s index.json lists: each module (source, warp or filter) whose file reads, by name, with its code; none
 * when the index cannot be read. */
export async function libraryFiles(dir: string): Promise<Library> {
  const library: Library = { modules: new Map() };
  const index = await fs.readFile(path.join(dir, 'index.json'), 'utf8').then(JSON.parse, () => []);
  for (const entry of Array.isArray(index) ? index : []) {
    if (!isNode(entry) || typeof entry.name !== 'string' || !NAME.test(entry.name) || entry.kind === 'preset') continue;
    const code = await fs.readFile(path.join(dir, `${entry.name}.js`), 'utf8').catch(() => null);
    if (code !== null) library.modules.set(entry.name, code);
  }
  return library;
}
