// The core as the render box takes it, from its source with no build (src/core-script.ts): one script for its realm.
// TypeScript modules work as well: their types are stripped as Node strips them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { afterAll, test } from 'vitest';

import { bundle, moduleFiles } from '../src/core-script.ts';

const CORE = fileURLToPath(new URL('../public/js/pattern-core.ts', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-core-script-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
  fs.writeFileSync(path.join(tmp, rel), text);
};

test('the core as one script: its modules, dependencies first, with no relative imports left', () => {
  const { text, files } = bundle(CORE);
  assert.equal(files.at(-1), CORE);
  assert.deepEqual(moduleFiles(CORE), files);
  assert.ok(files.some((f) => f.endsWith(path.join('core', 'stdlib.ts'))));
  assert.ok(!files.some((f) => f.includes(`${path.sep}shared${path.sep}`)), 'type-only imports name no module');
  assert.ok(!/^(?:import|export)\b[^;]*\bfrom\s*'\./m.test(text));
  const script = text.replace(/^export\s+(?=(?:const|let|var|function|class|async)\b)/gm, '');
  const ctx = vm.createContext({});
  vm.runInContext(`${script}\nglobalThis.out = typeof renderFrame + typeof prepareScene;`, ctx);
  assert.equal(ctx.out, 'functionfunction');
});

test('TypeScript modules: types stripped for the realm', () => {
  write('ts/lib/maths.ts', 'export type N = number;\nexport const twice = (n: N): N => n * 2;\n');
  write('ts/entry.ts', "import { twice } from './lib/maths.ts';\nexport const four: number = twice(2);\n");
  const { text, files } = bundle(path.join(tmp, 'ts/entry.ts'));
  assert.equal(files.length, 2);
  assert.ok(!/: N|type N/.test(text), text);
  const ctx = vm.createContext({});
  vm.runInContext(`${text.replace(/^export\s+/gm, '')}\nglobalThis.out = four;`, ctx);
  assert.equal(ctx.out, 4);
});
