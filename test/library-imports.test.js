// Imports go by ref: a module naming a library module is it, any code it carries ignored for the library's; one naming
// none is refused, and so, plainly, is a ref the library lacks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import { createCodeGate } from '../src/library-gate.ts';
import { parseFseq } from '../src/frames.ts';
import { createRenderBox } from '../src/render-box.ts';
import { createLoaders } from '../src/static.ts';
import { signup } from './fixtures/app.js';
import { quiet } from './fixtures/quiet.js';
import { fx, startApp, useFixture } from './fixtures/server.js';

useFixture();
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const oldNoise = execFileSync('git', ['show', '1cfdcda6:public/patterns/noise.js'],
  { cwd: publicDir, encoding: 'utf8' });
const layers = (code) => [{ id: 'l1', title: 'Noise', blend: 'add', level: 1, groups: ['cathedral'], modules: [
  { id: 'm1', ref: 'noise', title: 'Noise', kind: 'source', code, params: { speed: 0.2 } },
] }];

test('library only: an earlier Noise imports by its ref, as playable code; what names no module is refused',
  async () => {
  const current = readFileSync(path.join(publicDir, 'patterns/noise.js'), 'utf8');
  assert.notEqual(oldNoise, current);
  const currentWash = readFileSync(path.join(publicDir, 'patterns/colour-wash.js'), 'utf8');
  const wash = (code) => ({ id: 'm2', kind: 'source', title: 'Colour wash', ref: 'colour-wash', code, params: {} });
  const app = await startApp({ publicDir, dataDir: path.join(fx.tmp, 'history') });
  try {
    const ann = await signup(app, 'ann');
    const body = { origin: 'old-prod-noise', title: 'Simple Noise Bed', chain: 2, layers: layers(oldNoise) };
    body.layers[0].modules.push(wash(currentWash));
    body.globals = { macros: { breath: { value: 0.5, min: 0, max: 1 } } };
    body.automation = { breath: [[0, 0], [10, 1]], archAccent: [[0, 1]], roseAccent: [[0, 1]],
      towerAccent: [[0, 1]], canopyAccent: [[0, 1]] };
    const imported = await ann.post('/api/looks', body);
    assert.equal(imported.status, 201, imported.text);
    assert.equal(imported.json.imported, 'added');
    const expected = layers(current);
    expected[0].modules.push(wash(currentWash));
    assert.deepEqual(imported.json.look.layers, expected);
    assert.deepEqual(imported.json.look.automation, { breath: body.automation.breath },
      'stale lanes for missing macros are inert; keep the real macro lane');
    const box = createRenderBox({ seconds: 1, systemdRun: '', log: quiet });
    const baked = await box.render({ layers: imported.json.look.layers });
    assert.equal(parseFseq(baked.bytes).frameCount, 40, 'the imported look really bakes');
    const repeated = await ann.post('/api/looks', body);
    assert.equal(repeated.status, 200, repeated.text);
    assert.equal(repeated.json.imported, 'unchanged');
    const badLane = await ann.put(`/api/looks/${imported.json.look.id}`, { automation: { archAccent: [[0, 1]] } });
    assert.equal(badLane.status, 400, 'ordinary edits still reject unknown automation lanes');
    const badValue = await ann.post('/api/looks', { ...body, automation: { breath: [[0, 2]] } });
    assert.equal(badValue.status, 400, 'a present macro lane still validates its range');
    const edited = await ann.post('/api/looks', { ...body, origin: 'edited', layers: layers(`${oldNoise}\n// x`) });
    assert.equal(edited.status, 201, edited.text);
    assert.equal(edited.json.look.layers[0].modules[0].code, current, 'an edited copy naming noise plays noise');
    const unnamed = layers(oldNoise);
    delete unnamed[0].modules[0].ref;
    const old = await ann.post('/api/looks', { ...body, origin: 'unnamed', layers: unnamed });
    assert.equal(old.status, 400, 'an earlier copy naming nothing is refused');
    assert.match(old.json.error, /ref must name a library entry/);
    const gone = await ann.post('/api/looks', { ...body, origin: 'gone', layers: [{ ...unnamed[0], modules: [
      { id: 'm1', ref: 'tendril', title: 'Tendril', kind: 'source', params: {} }] }] });
    assert.equal(gone.status, 403, gone.text);
    assert.equal(gone.json.error, 'Layer 1 (Noise)\'s Tendril names tendril, which the library does not have.');
  } finally {
    await app.close();
  }
});

test('the gate: a ref the library has passes, whatever code it carries; code naming nothing, or a retired ref, does '
  + 'not', async () => {
  const patternsDir = path.join(publicDir, 'patterns');
  const gate = createCodeGate(createLoaders(publicDir, { log: quiet }).loadLibrary);
  const allows = (m) => gate.check([{ modules: [{ id: 'm1', kind: 'source', title: 'N', ...m }] }],
    (why) => new Error(why)).then(() => true, () => false);
  assert.equal(await allows({ ref: 'noise', code: oldNoise }), true);
  assert.equal(await allows({ code: readFileSync(path.join(patternsDir, 'noise.js'), 'utf8') }), false,
    'even a current file names nothing');
  assert.equal(await allows({ ref: 'butterfly-classic' }), false, 'retired: no longer in the library');
});
