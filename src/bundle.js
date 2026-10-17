// An ES module and what it imports as one script, for what cannot load modules: the sandbox's
// worker (a Blob at an opaque origin) and the boxes. Dependencies come first; relative import and
// re-export lines go, `export` keywords stay, so the result is still a module of its own.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FROM = /^(?:import|export)\b[^;]*?\bfrom\s*'(\.{1,2}\/[^']+)';[ \t]*\n?/gm;

/** bundle(file) → { text, files }; `files` (every module read) lets a caller cache on them. */
export function bundle(file) {
  const files = [];
  const parts = [];
  const visit = (f) => {
    if (files.includes(f)) return;
    files.push(f);
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(FROM)) visit(path.resolve(path.dirname(f), m[1]));
    parts.push(text.replace(FROM, ''));
  };
  visit(path.resolve(file));
  return { text: parts.join('\n'), files };
}
