// The pattern core for the boxes, from its source as it is (no build): the modules a file imports, for the Fleet
// workspace's copy and the bake key, and all of them as one script for the render box's node:vm realm, which cannot
// import. A .ts module's types are stripped as Node strips them when it runs one.
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

// Relative import and re-export lines (a bundle drops them; `export` keywords stay, so it is still a module).
const FROM = /^(?:import|export)\b[^;]*?\bfrom\s*'(\.{1,2}\/[^']+)';[ \t]*\n?/gm;

const read = (file) => {
  const text = readFileSync(file, 'utf8');
  return file.endsWith('.ts') ? stripTypeScriptTypes(text) : text;
};

/** moduleFiles(file) → the module and every module it imports, dependencies first (the module itself last). */
export function moduleFiles(file) {
  const seen = new Set(), files = [];
  const visit = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of readFileSync(f, 'utf8').matchAll(FROM)) visit(path.resolve(path.dirname(f), m[1]));
    files.push(f);
  };
  visit(path.resolve(file));
  return files;
}

/** bundle(file) → { text, files }: the module and what it imports as one script; `files` as moduleFiles(). */
export function bundle(file) {
  const files = moduleFiles(file);
  return { text: files.map((f) => read(f).replace(FROM, '')).join('\n'), files };
}
