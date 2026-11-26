// tools/rewrite-looks.ts on a data folder: stored looks written as the current code reads them, what plays and a
// current bake kept, the old file kept beside, the dry run writing nothing, and a second run changing nothing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import { compileLayer, prepareLayer, prepareLook, prepareScene, renderFrame } from '../core/pattern-core.ts';
import { layersHash, renderFields } from '../src/bake.ts';
import { libraryRefs } from '../src/library-refs.ts';
import { createLoaders } from '../src/static.ts';
import { lockDataDir } from '../src/store-lock.ts';
import { rewriteLooks } from '../tools/rewrite-looks.ts';
import { cog } from './fixtures/rigs.js';
import { fx, useFixture } from './fixtures/server.js';

useFixture();
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const file = (name) => readFileSync(path.join(publicDir, 'patterns', `${name}.js`), 'utf8');
const refs = libraryRefs(createLoaders(publicDir, { log: { warn() {} } }).loadLibrary);
const read = (look) => refs.read(structuredClone(look));
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const scene = prepareScene(cog);

/** A look as an older Studio stored it: code beside each ref, old globals, bars saved as `round`, a version. */
function stored(id, { code = file('bars') } = {}) {
  const layers = [{ id: 'l1', title: 'Bars', blend: 'add', level: 1, modules: [
    { id: 'm1', kind: 'source', title: 'Bars', ref: 'bars', code, params: { direction: 'round', bars: 3 } },
    { id: 'm2', kind: 'warp', title: 'Mirror', ref: 'mirror', code: file('mirror'), params: {} }] }];
  const look = { id, owner: 'u1', title: `Look ${id}`, chain: 2, layers, duration: 30,
    globals: { speed: 1.2, hue: 0.1, energy: 0.7, macros: {} }, automation: { speed: [[0, 1]] }, shared: true,
    reviewed: true, versions: [{ n: 1, layers: structuredClone(layers), globals: { level: 0.5 } }] };
  return { ...look, bake: { status: 'done', source: 'render-box', layersHash: layersHash(renderFields(read(look))) } };
}

/** Frames of `look` as the bake plays it: its read layers on City of Gods. */
function frames(look) {
  const r = read(look), g = prepareLook(r);
  const layers = r.layers.map((l) => prepareLayer(scene, l, compileLayer(l)));
  return [0, 1.3, 7.7].map((t) => Array.from(renderFrame(scene, layers, t, null, g).rgb));
}

function folder(name, looks) {
  const dir = path.join(fx.tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'looks.json'), `[\n${looks.map((l) => JSON.stringify(l)).join(',\n')}\n]\n`);
  return dir;
}
const looksIn = (dir) => JSON.parse(readFileSync(path.join(dir, 'looks.json'), 'utf8'));

test('the dry run says what it would change and writes nothing', async () => {
  const dir = folder('dry', [stored('a')]);
  const before = readFileSync(path.join(dir, 'looks.json'), 'utf8');
  const { rewrites, backup } = await rewriteLooks({ dataDir: dir, publicDir });
  assert.equal(backup, null);
  assert.equal(readFileSync(path.join(dir, 'looks.json'), 'utf8'), before);
  assert.deepEqual(readdirSync(dir), ['looks.json']);
  assert.equal(rewrites[0].bake, 'kept');
  assert.deepEqual(rewrites[0].changes, ['globals as they play', 'params upgraded: Bars',
    'code dropped from 2 modules', 'globals as they play (version 1)', 'params upgraded: Bars (version 1)',
    'code dropped from 2 modules (version 1)']);
});

test('applied: the current shape, what plays and a current bake kept, the old file beside; again changes nothing',
  async () => {
    const was = stored('a');
    const dir = folder('apply', [was]);
    const bytes = readFileSync(path.join(dir, 'looks.json'));
    const { backup } = await rewriteLooks({ dataDir: dir, publicDir, apply: true,
      now: new Date('2026-11-26T10:00:00.5Z') });
    assert.equal(path.basename(backup), 'looks.pre-rewrite-2026-11-26T10-00-00Z.json');
    assert.deepEqual(readFileSync(backup), bytes);
    const [look] = looksIn(dir);
    const codes = was.layers[0].modules.map((m) => m.code);
    assert.equal(look.codeHash, sha256(JSON.stringify(codes)), 'the hash of the code it was saved with');
    assert.equal(look.versions[0].codeHash, look.codeHash);
    for (const l of [look, look.versions[0]]) {
      assert.ok(l.layers[0].modules.every((m) => !('code' in m)), 'refs alone');
      assert.equal(l.layers[0].modules[0].params.direction, 'clockwise', 'bars\' upgrade()');
    }
    assert.deepEqual(look.globals, { macros: { energy: { value: 0.7, min: 0, max: 1 } } });
    assert.equal(look.automation, null);
    assert.deepEqual(look.versions[0].globals, {});
    assert.deepEqual(frames(look), frames(was), 'it plays as before');
    const now = read(look);
    assert.equal(now.bake.layersHash, layersHash(renderFields(now)), 'its bake is still current');
    assert.equal(now.reviewed, true);

    const again = await rewriteLooks({ dataDir: dir, publicDir, apply: true });
    assert.deepEqual(again.rewrites.map((r) => r.changes), [[]]);
    assert.equal(again.backup, null);
    assert.deepEqual(looksIn(dir), [look]);
  });

test('a look whose code the library has changed since keeps the hash of its own, so reads still drop its bake',
  async () => {
    const was = stored('old', { code: '// an earlier bars\nfunction pixel() { return [1, 0, 0]; }' });
    const dir = folder('old', [was]);
    const { rewrites } = await rewriteLooks({ dataDir: dir, publicDir, apply: true });
    assert.equal(rewrites[0].bake, 'stale');
    const [look] = looksIn(dir);
    assert.equal(look.codeHash, sha256(JSON.stringify(was.layers[0].modules.map((m) => m.code))));
    const now = read(look);
    assert.deepEqual([now.bake, now.reviewed], [undefined, false], 'as a read of the look before gives it');
  });

test('--apply leaves a folder a server holds alone', async () => {
  const dir = folder('held', [stored('a')]);
  const lock = await lockDataDir(dir);
  try {
    await assert.rejects(rewriteLooks({ dataDir: dir, publicDir, apply: true }));
  } finally {
    await lock.release();
  }
  assert.ok(!looksIn(dir)[0].codeHash);
  assert.ok(!readdirSync(dir).some((f) => f.startsWith('looks.pre-rewrite')));
});

test('a chain from before the one rule converted inexactly: its bake is not kept, nor its review', async () => {
  const mod = (name, kind) => ({ id: name, kind, title: name, ref: name, code: file(name), params: {} });
  const look = { id: 'v1', owner: 'u1', title: 'Old', reviewed: true,
    layers: [{ id: 'l1', modules: [mod('twist', 'warp'), mod('bars', 'source'), mod('trails', 'filter')] }] };
  const bake = { status: 'done', source: 'render-box', layersHash: layersHash(renderFields(read(look))) };
  const was = { ...look, bake };
  const dir = folder('inexact', [was]);
  const { rewrites } = await rewriteLooks({ dataDir: dir, publicDir, apply: true });
  assert.equal(rewrites[0].bake, 'stale');
  const now = read(looksIn(dir)[0]);
  assert.equal(now.chain, 2);
  assert.notEqual(now.bake?.layersHash, layersHash(renderFields(now)));
  assert.equal(now.reviewed, false);
});

test('a module saved with no ref takes its code\'s before upgrade(), so one run does it all', async () => {
  const was = stored('noref');
  for (const l of [was, was.versions[0]]) delete l.layers[0].modules[0].ref;
  const dir = folder('noref', [was]);
  await rewriteLooks({ dataDir: dir, publicDir, apply: true });
  const [look] = looksIn(dir);
  for (const l of [look, look.versions[0]]) {
    assert.deepEqual([l.layers[0].modules[0].ref, l.layers[0].modules[0].params.direction], ['bars', 'clockwise']);
  }
  assert.deepEqual((await rewriteLooks({ dataDir: dir, publicDir, apply: true })).rewrites.map((r) => r.changes), [[]]);
});

test('a look whose only old field is a version layer\'s remap is written without it', async () => {
  const dir = folder('remap', [stored('a')]);
  await rewriteLooks({ dataDir: dir, publicDir, apply: true });
  const [look] = looksIn(dir);
  look.versions[0].layers[0].palette = { a: 'b' };
  writeFileSync(path.join(dir, 'looks.json'), `[\n${JSON.stringify(look)}\n]\n`);
  const { rewrites } = await rewriteLooks({ dataDir: dir, publicDir, apply: true, now: new Date(2e12) });
  assert.deepEqual(rewrites[0].changes, ['chain or remaps converted']);
  assert.ok(!('palette' in looksIn(dir)[0].versions[0].layers[0]));
});
