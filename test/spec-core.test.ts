// What spec/library "Sandbox protocol" says core/pattern-core.ts and core/fseq.ts export, they do: each function
// (named with its arguments), constant (in capitals) and type (capitalized) the paragraph on a module names.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { test } from 'vitest';

import * as fseq from '../core/fseq.ts';
import * as core from '../core/pattern-core.ts';

const spec = readFileSync(new URL('../spec/library.md', import.meta.url), 'utf8');
const between = (from: string, to: string) => spec.slice(spec.indexOf(from), to ? spec.indexOf(to) : undefined);
const source = (file: string) => readFileSync(new URL(`../core/${file}`, import.meta.url), 'utf8');

/** The names a paragraph gives as exports: `name(…)`, `new Name(…)`, `CONSTANT` and `Type`. */
function named(text: string) {
  const out = new Set<string>();
  for (const [, name, rest] of text.matchAll(/`(?:new )?([A-Za-z_]\w*)([^`]*)`/g)) {
    if (rest!.startsWith('(') || /^[A-Z]/.test(name!)) out.add(name!);
  }
  return [...out];
}

for (const [file, mod, text] of [
  ['pattern-core.ts', core, between('`core/pattern-core.ts` exports', '`core/fseq.ts` exports')],
  ['fseq.ts', fseq, between('`core/fseq.ts` exports', '')],
] as const) {
  test(`what the spec says core/${file} exports, it does`, () => {
    const names = named(text), types = source(file);
    assert.ok(names.length >= 5, `${names.length} names`);
    const missing = names.filter((n) => !(n in mod) && !new RegExp(`^export type[^;]*\\b${n}\\b`, 'm').test(types));
    assert.deepEqual(missing, []);
  });
}
