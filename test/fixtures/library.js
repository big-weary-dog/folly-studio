// A one-module library for tests that build their own public folder: only library code saves (spec/frames "Library
// only"), so their looks name it, told apart by their params.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** glow.js: the library's one source. */
export const GLOW = '// Glow\nfunction pixel(p) { return [p.x, p.y, p.z]; }\n';

/** A layer of the glow module with `params`, as a body names it. */
export const glowLayer = (params = {}) => ({ modules: [{ kind: 'source', title: 'Glow', ref: 'glow', params }] });

/** Writes the library into `publicDir`'s patterns/. */
export async function writeLibrary(publicDir) {
  await mkdir(path.join(publicDir, 'patterns'), { recursive: true });
  await writeFile(path.join(publicDir, 'patterns', 'index.json'), JSON.stringify([{ name: 'glow', title: 'Glow' }]));
  await writeFile(path.join(publicDir, 'patterns', 'glow.js'), GLOW);
}
