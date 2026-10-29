// Imports upgrade exact historical library code without granting trust to an edited copy or a claimed ref.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import { customCode, libraryHashes } from '../src/box-library.ts';
import { createCodeGate } from '../src/custom-code.ts';
import { parseFseq } from '../src/frames.ts';
import { createRenderBox } from '../src/render-box.ts';
import { fx, quiet, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const oldNoise = execFileSync('git', ['show', '1cfdcda6:public/patterns/noise.js'],
  { cwd: publicDir, encoding: 'utf8' });
const layers = (code) => [{ id: 'l1', title: 'Noise', blend: 'add', level: 1, groups: ['cathedral'], modules: [
  { id: 'm1', ref: 'noise', title: 'Noise', kind: 'source', code, params: { speed: 0.2 } },
] }];

test('custom code off: import an earlier committed Noise, upgrade to playable code, reject edits', async () => {
  const current = readFileSync(path.join(publicDir, 'patterns/noise.js'), 'utf8');
  assert.notEqual(oldNoise, current);
  const oldWash = execFileSync('git', ['show', 'ab6dbd0d:public/patterns/colour-wash.js'],
    { cwd: publicDir, encoding: 'utf8' });
  const currentWash = readFileSync(path.join(publicDir, 'patterns/colour-wash.js'), 'utf8');
  assert.notEqual(oldWash, currentWash);
  const wash = (code) => ({ id: 'm2', kind: 'source', title: 'Colour wash', code, params: {} });
  const app = await startApp({ publicDir, dataDir: path.join(fx.tmp, 'history'), customCode: false });
  try {
    const ann = await signup(app, 'ann');
    const body = { origin: 'old-prod-noise', title: 'Simple Noise Bed', chain: 2, layers: layers(oldNoise) };
    body.layers[0].modules.push(wash(oldWash)); // Older saved library modules need not carry a ref.
    const imported = await ann.post('/api/looks', body);
    assert.equal(imported.status, 201, imported.text);
    assert.equal(imported.json.imported, 'added');
    const expected = layers(current);
    expected[0].modules.push(wash(currentWash));
    assert.deepEqual(imported.json.look.layers, expected);
    assert.equal(customCode(imported.json.look.layers, await libraryHashes(path.join(publicDir, 'patterns'))), '',
      'the imported look passes the render box gate without bubblewrap');
    const box = createRenderBox({ bwrap: 'no-such-bwrap', seconds: 1, systemdRun: '', log: quiet });
    assert.ok((await box.probe()).libraryOnly);
    const baked = await box.render({ layers: imported.json.look.layers });
    assert.equal(parseFseq(baked.bytes).frameCount, 40, 'the imported look really bakes without bubblewrap');
    const repeated = await ann.post('/api/looks', body);
    assert.equal(repeated.status, 200, repeated.text);
    assert.equal(repeated.json.imported, 'unchanged');
    const edited = await ann.post('/api/looks', { ...body, layers: layers(`${oldNoise}\n// edited`) });
    assert.equal(edited.status, 403, edited.text);
    assert.match(edited.json.error, /Noise is new code/);
    const spoof = await ann.post('/api/looks', { ...body, layers: layers('function pixel() { return [1,0,0]; }') });
    assert.equal(spoof.status, 403, 'a library ref alone grants no trust');
  } finally {
    await app.close();
  }
});

test('historical trust reaches the generator gate but never the unboxed render allowlist', async () => {
  const patternsDir = path.join(publicDir, 'patterns');
  const gate = createCodeGate({ on: () => false, looks: { list: () => [] }, patternsDir });
  const allows = await gate.allows('u');
  assert.equal(allows(oldNoise), true);
  assert.equal(allows(`${oldNoise} `), false);
  const retired = execFileSync('git', ['show', 'a6462ae3:public/patterns/butterfly.js'],
    { cwd: publicDir, encoding: 'utf8' });
  assert.equal(allows(retired), false, 'retired patterns have no current library replacement');
  assert.match(customCode(layers(oldNoise), await libraryHashes(patternsDir)), /custom code/);
});
