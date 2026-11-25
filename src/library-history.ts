// Historical fingerprints identify exact library copies; upgrading them moves saved looks onto the current library.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Layer, Module } from '../shared/schemas/look.ts';

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Each code entry `dir`'s index.json lists (presets have none): its current file, and the SHA-256 of that file and
 * of its earlier copies (history.json). None when the index is missing. With `retired`, history.json's patterns the
 * index no longer lists too, with no current file (`code` null). */
export async function libraryFiles(dir: string, { retired = false } = {}) {
  const history = await fs.readFile(path.join(dir, 'history.json'), 'utf8').then(JSON.parse, () => ({}));
  const index = await fs.readFile(path.join(dir, 'index.json'), 'utf8').then(JSON.parse, () => []);
  const files = new Map<string, { code: string | null, hashes: Set<string> }>();
  const ids = (name: string) => (Array.isArray(history?.[name]) ? history[name] as unknown[] : [])
    .filter((h): h is string => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h));
  for (const entry of Array.isArray(index) ? index : []) {
    if (!entry || entry.kind === 'preset' || !/^[a-z0-9-]{1,64}$/.test(entry.name)) continue;
    const code = await fs.readFile(path.join(dir, `${entry.name}.js`), 'utf8').catch(() => null);
    if (code === null) continue;
    files.set(entry.name, { code, hashes: new Set([sha256(code), ...ids(entry.name)]) });
  }
  if (retired && files.size) {
    for (const name of Object.keys(history ?? {})) {
      if (files.has(name) || !/^[a-z0-9-]{1,64}$/.test(name)) continue;
      files.set(name, { code: null, hashes: new Set(ids(name)) });
    }
  }
  return files;
}

export async function historicalLibrary(dir: string) {
  const replacements = new Map<string, string>();
  for (const { code, hashes } of (await libraryFiles(dir)).values()) {
    for (const hash of hashes) replacements.set(hash, code!);
  }
  const replace = (code: string) => replacements.get(sha256(code)) ?? code;
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
