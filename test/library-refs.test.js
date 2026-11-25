// A stored module is its ref: reads fill the library's current file, writes keep no code, a module's ref follows its
// exact file (hidden and renamed entries too), and every module the library-only step keeps resolves.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import { layersHash, renderFields } from '../src/bake.ts';
import { libraryFiles } from '../src/library-history.ts';
import { libraryRefs } from '../src/library-refs.ts';
import { createLoaders } from '../src/static.ts';
import { createStore } from '../src/store.ts';
import { fx, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const patterns = path.join(publicDir, 'patterns');
const file = (name) => readFileSync(path.join(patterns, `${name}.js`), 'utf8');
const git = (spec) => execFileSync('git', ['show', spec], { cwd: publicDir, encoding: 'utf8' });
const { loadLibrary } = createLoaders(publicDir, { log: { warn() {} } });
const refs = libraryRefs(loadLibrary, path.join(patterns, 'history.json'));
const look = (...modules) => ({ layers: [{ id: 'l1', modules: modules.map((m, i) => ({ id: `m${i + 1}`, ...m })) }],
  versions: [{ layers: [{ id: 'l1', modules: [{ id: 'm1', ...modules[0] }] }] }] });
const mods = (l) => [...l.layers[0].modules, ...l.versions[0].layers[0].modules];

test('a read fills each module from its ref, whatever was stored; a write keeps no code', () => {
  const read = refs.read(look({ ref: 'noise', code: 'stale' }, { ref: 'no-such-pattern', code: 'x' }));
  assert.deepEqual(mods(read).map((m) => m.code), [file('noise'), '', file('noise')]);
  const written = refs.write(look({ ref: 'noise', code: file('noise') }));
  assert.ok(mods(written).every((m) => !('code' in m) && m.ref === 'noise'));
});

test('a module takes the ref of its exact file: an earlier copy, no ref, a renamed entry', () => {
  const oldWash = git('ab6dbd0d:public/patterns/colour-wash.js');
  assert.equal(refs.write(look({ code: oldWash })).layers[0].modules[0].ref, 'colour-wash');
  for (const plasma of [git('c3b574b0:public/patterns/plasma.js'), file('plasma-classic')]) {
    const read = refs.read(look({ ref: 'plasma', code: plasma }));
    const classic = ['plasma-classic', file('plasma-classic')];
    assert.deepEqual(mods(read).map((m) => [m.ref, m.code]), [0, 1].map(() => classic));
  }
});

test('a ref whose code is no known file keeps its ref: plasma stays the preset\'s name', () => {
  const read = refs.read(look({ ref: 'plasma', code: `${file('plasma-classic')}\n// edited` }));
  assert.deepEqual(mods(read).map((m) => [m.ref, m.code]), [0, 1].map(() => ['plasma', '']));
});

test('a bake of other code than the look\'s now is left out, with its review; a current one stays through writes',
  async () => {
    const store = await createStore(path.join(fx.tmp, 'stale'), { log: { error() {} }, views: { looks: refs } });
    const layers = (code) => [{ id: 'l1', title: 'Noise', modules: [{ id: 'm1', kind: 'source', title: 'Noise',
      ref: 'noise', code, params: {} }] }];
    const baked = (code) => ({ owner: 'u1', title: 'x', layers: layers(code), reviewed: true, reviewedBy: 'u2',
      bake: { status: 'done', ok: true, layersHash: layersHash(renderFields({ layers: layers(code) })) } });
    const oldNoise = git('1cfdcda6:public/patterns/noise.js');
    const old = store.looks.create({ ...baked(oldNoise), versions: [{ n: 1, layers: layers(oldNoise), reviewed: true },
      { n: 2, layers: layers(file('noise')), reviewed: true }] });
    assert.deepEqual([old.bake, old.reviewed, old.reviewedBy], [undefined, false, undefined]);
    assert.deepEqual(old.versions.map((v) => v.reviewed), [false, true], 'a version the library changed: no review');
    assert.deepEqual(store.looks.list((l) => !!l.bake).map((l) => l.id), [], 'a filter sees what a read gives');
    // A rebake asked for: the review that rested on the stale bake stays gone.
    const asked = store.looks.update(old.id, { bake: { status: 'queued' } });
    assert.deepEqual([asked.reviewed, asked.reviewedBy, asked.versions[0].reviewed], [false, undefined, false]);
    const now = store.looks.create(baked(file('noise')));
    assert.equal(now.bake?.layersHash, layersHash(renderFields(now)));
    const shared = store.looks.update(now.id, { shared: true });
    assert.deepEqual([shared.bake?.ok, shared.reviewed], [true, true], 'a write without code keeps the bake current');
    assert.deepEqual(Object.keys(shared.layers[0].modules[0]), ['id', 'kind', 'title', 'ref', 'code', 'params']);
    await store.flush();
  });

test('every module the library-only step keeps names a module a read fills', async () => {
  const kept = [...await libraryFiles(patterns, { retired: true })].filter(([, f]) => f.code !== null);
  const modules = new Map(loadLibrary().filter((e) => e.kind !== 'preset').map((e) => [e.name, e.code]));
  assert.deepEqual(kept.filter(([name, f]) => modules.get(name) !== f.code).map(([name]) => name), []);
  for (const name of ['tendril', 'stained-glass', 'butterfly-classic', 'plasma-classic', 'lighthouse-classic']) {
    assert.ok(kept.some(([n]) => n === name), `${name}, which prod's looks use`);
  }
});

test('hidden modules play stored looks but stay off the shelf', async () => {
  const app = await startApp({ publicDir, dataDir: path.join(fx.tmp, 'refs'), customCode: false });
  try {
    const shelf = (await (await fetch(`${app.base}/api/library`)).json()).patterns.map((e) => e.name);
    assert.ok(!shelf.includes('plasma-classic') && shelf.includes('plasma'));
    const ann = await signup(app, 'ann');
    const old = git('c3b574b0:public/patterns/plasma.js');
    const made = await ann.post('/api/looks', { title: 'Old plasma', chain: 2, layers: [{ id: 'l1', title: 'Plasma',
      blend: 'add', level: 1, groups: ['cathedral'], modules: [{ id: 'm1', kind: 'source', ref: 'plasma', code: old,
        title: 'Plasma', params: {} }] }] });
    assert.equal(made.status, 201, made.text);
    const m = (await ann.get(`/api/looks/${made.json.look.id}`)).json.look.layers[0].modules[0];
    assert.deepEqual([m.ref, m.code], ['plasma-classic', file('plasma-classic')]);
    await app.store.flush();
    const stored = JSON.parse(readFileSync(path.join(fx.tmp, 'refs', 'looks.json'), 'utf8'));
    assert.ok(!('code' in stored[0].layers[0].modules[0]), 'the stored module keeps no code');
  } finally {
    await app.close();
  }
});
