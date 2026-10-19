// The pattern core for the boxes, from its source as it is (no build): the modules a file imports, for the Fleet
// workspace's copy and the bake key, and all of them as one script for the render box's node:vm realm, which cannot
// import. A .ts module's types are stripped as Node strips them when it runs one.
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

// Relative import and re-export lines (a bundle drops them; `export` keywords stay, so it is still a module). Type-only
// ones (`import type`) name no module that runs.
const FROM = /^(?:import|export)\b([^;]*?)\bfrom\s*'(\.{1,2}\/[^']+)';[ \t]*\n?/gm;

/** fn() without Node's ExperimentalWarning about `feature` (Node warns once, on first use). */
export function quietly<T>(feature: RegExp, fn: () => T): T {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: [{ type?: string } | string | undefined]) => {
    const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type ?? (warning as Error).name;
    if (type === 'ExperimentalWarning' && feature.test(String((warning as Error).message ?? warning))) return;
    return emit.apply(process, [warning, ...rest] as Parameters<typeof emit>);
  }) as typeof emit;
  try { return fn(); } finally { process.emitWarning = emit; }
}

const read = (file: string) => {
  const text = readFileSync(file, 'utf8');
  return file.endsWith('.ts') ? quietly(/stripTypeScriptTypes/, () => stripTypeScriptTypes(text)) : text;
};

/** moduleFiles(file) → the module and every module it imports, dependencies first (the module itself last). */
export function moduleFiles(file: string) {
  const seen = new Set<string>(), files: string[] = [];
  const visit = (f: string) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of readFileSync(f, 'utf8').matchAll(FROM)) {
      if (!/^\s*type\b/.test(m[1]!)) visit(path.resolve(path.dirname(f), m[2]!));
    }
    files.push(f);
  };
  visit(path.resolve(file));
  return files;
}

/** bundle(file) → { text, files }: the module and what it imports as one script; `files` as moduleFiles(). */
export function bundle(file: string) {
  const files = moduleFiles(file);
  return { text: files.map((f) => read(f).replace(FROM, '')).join('\n'), files };
}
