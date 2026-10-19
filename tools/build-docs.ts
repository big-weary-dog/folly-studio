#!/usr/bin/env node
// The library docs the AI builders read (SPEC-generators "Library docs"), written to a folder for people to read:
// the server builds the same tree in memory from the live library.
//
//   node tools/build-docs.ts <out dir> [--public <dir>]
//
// Prose comes from library-docs/; params, ranges, defaults, units and recipes from the library (public/patterns/).
// Prints what has no prose and what the prose names that the library lacks.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { buildCatalog } from '../src/generate/catalog.ts';
import { buildDocs, lintDocs, loadProse, looksOf } from '../src/generate/library-docs.ts';
import { createLog } from '../src/http.ts';
import { createLoaders } from '../src/static.ts';

const args = process.argv.slice(2), at = args.indexOf('--public');
const out = args.find((a, i) => !a.startsWith('--') && (at < 0 || i !== at + 1));
if (!out) {
  console.error('usage: node tools/build-docs.ts <out dir> [--public <dir>]');
  process.exit(2);
}
const log = Object.assign(createLog('[build-docs]'), { info() {} });
const library = createLoaders(at >= 0 ? args[at + 1] : undefined, { log }).loadLibrary();
const prose = loadProse(), catalog = buildCatalog(library, looksOf(prose));
const docs = buildDocs(catalog, prose);
for (const [rel, text] of docs) {
  mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
  writeFileSync(path.join(out, rel), text);
}
const { missing, unhelped, errors } = lintDocs(catalog, prose);
console.log(`${docs.size} docs in ${path.join(out, 'library')}`);
if (missing.length) console.log(`no prose: ${missing.join(', ')}`);
if (unhelped.length) console.log(`no help: ${unhelped.join(', ')}`);
for (const e of errors) console.log(e);
