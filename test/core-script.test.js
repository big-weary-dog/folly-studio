// The core as the boxes take it, from its source with no build (src/core-script.js, generate/fleet.js copyModule):
// one script for the render box's realm, and module copies the Fleet worker imports. TypeScript modules work as
// well: their types are stripped as Node strips them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

import { bundle, moduleFiles } from '../src/core-script.js';
import { copyModule } from '../src/generate/fleet.js';

const CORE = fileURLToPath(new URL('../public/js/pattern-core.js', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-core-script-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
  fs.writeFileSync(path.join(tmp, rel), text);
};

test('the core as one script: its modules, dependencies first, with no relative imports left', () => {
  const { text, files } = bundle(CORE);
  assert.equal(files.at(-1), CORE);
  assert.deepEqual(moduleFiles(CORE), files);
  assert.ok(files.some((f) => f.endsWith(path.join('core', 'stdlib.js'))));
  assert.ok(!/^(?:import|export)\b[^;]*\bfrom\s*'\./m.test(text));
  const script = text.replace(/^export\s+(?=(?:const|let|var|function|class|async)\b)/gm, '');
  const ctx = vm.createContext({});
  vm.runInContext(`${script}\nglobalThis.out = typeof renderFrame + typeof prepareScene;`, ctx);
  assert.equal(ctx.out, 'functionfunction');
});

test('TypeScript modules: types stripped for the realm, imported as they are from a copy', async () => {
  write('ts/lib/maths.ts', 'export type N = number;\nexport const twice = (n: N): N => n * 2;\n');
  write('ts/entry.ts', "import { twice } from './lib/maths.ts';\nexport const four: number = twice(2);\n");
  const { text, files } = bundle(path.join(tmp, 'ts/entry.ts'));
  assert.equal(files.length, 2);
  assert.ok(!/: N|type N/.test(text), text);
  const ctx = vm.createContext({});
  vm.runInContext(`${text.replace(/^export\s+/gm, '')}\nglobalThis.out = four;`, ctx);
  assert.equal(ctx.out, 4);
  await copyModule(path.join(tmp, 'ts/entry.ts'), path.join(tmp, 'box'), 'core.ts');
  assert.ok(fs.existsSync(path.join(tmp, 'box/lib/maths.ts')));
  assert.equal((await import(pathToFileURL(path.join(tmp, 'box/core.ts')).href)).four, 4);
});

test('the Fleet copy of the real core imports and renders', async () => {
  await copyModule(CORE, path.join(tmp, 'fleet'));
  const core = await import(pathToFileURL(path.join(tmp, 'fleet/pattern-core.js')).href);
  assert.equal(typeof core.renderFrame, 'function');
  assert.ok(fs.existsSync(path.join(tmp, 'fleet/core/compile.js')));
});
