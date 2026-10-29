// Historical fingerprints identify exact library copies; upgrading them lets the Pi use its current library.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Layer, Module } from '../shared/schemas/look.ts';

export async function historicalLibrary(dir: string) {
  const history = await fs.readFile(path.join(dir, 'history.json'), 'utf8').then(JSON.parse, () => ({}));
  const index = await fs.readFile(path.join(dir, 'index.json'), 'utf8').then(JSON.parse, () => []);
  const replacements = new Map<string, string>();
  for (const entry of Array.isArray(index) ? index : []) {
    if (entry.kind === 'preset' || !/^[a-z0-9-]{1,64}$/.test(entry.name)) continue;
    const hashes = history?.[entry.name];
    if (!Array.isArray(hashes)) continue;
    const code = await fs.readFile(path.join(dir, `${entry.name}.js`), 'utf8').catch(() => null);
    if (code === null) continue;
    for (const hash of hashes) {
      if (typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) replacements.set(hash, code);
    }
  }
  const replace = (code: string) => replacements.get(createHash('sha256').update(code).digest('hex')) ?? code;
  const modules = (list: Module[]) => {
    for (const m of list) {
      if (m.kind === 'composite' && m.layers) for (const sub of m.layers) modules(sub.modules);
      else m.code = replace(m.code);
    }
  };
  const upgrade = (layers: Layer[]): Layer[] => {
    const copy = structuredClone(layers);
    for (const layer of copy) {
      if ('modules' in layer) modules(layer.modules);
      else layer.code = replace(layer.code);
    }
    return copy;
  };
  return { hashes: new Set(replacements.keys()), upgrade };
}
