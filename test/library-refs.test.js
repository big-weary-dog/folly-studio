// A stored module is its ref: reads fill the library's current file, writes keep no code, a module naming no library
// module takes the ref of its exact file.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import { layersHash, renderFields } from '../src/bake.ts';
import { libraryRefs } from '../src/library-refs.ts';
import { createLoaders } from '../src/static.ts';
import { createStore } from '../src/store.ts';
import { signup } from './fixtures/app.js';
import { fx, startApp, useFixture } from './fixtures/server.js';

useFixture();
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const patterns = path.join(publicDir, 'patterns');
const file = (name) => readFileSync(path.join(patterns, `${name}.js`), 'utf8');
const git = (spec) => execFileSync('git', ['show', spec], { cwd: publicDir, encoding: 'utf8' });
const { loadLibrary } = createLoaders(publicDir, { log: { warn() {} } });
const refs = libraryRefs(loadLibrary);
const look = (...modules) => ({ layers: [{ id: 'l1', modules: modules.map((m, i) => ({ id: `m${i + 1}`, ...m })) }],
  versions: [{ layers: [{ id: 'l1', modules: [{ id: 'm1', ...modules[0] }] }] }] });
const mods = (l) => [...l.layers[0].modules, ...l.versions[0].layers[0].modules];

test('a read fills each module from its ref, whatever was stored; a write keeps no code', () => {
  const read = refs.read(look({ ref: 'noise', code: 'stale' }, { ref: 'no-such-pattern', code: 'x' }));
  assert.deepEqual(mods(read).map((m) => m.code), [file('noise'), '', file('noise')]);
  const written = refs.write(look({ ref: 'noise', code: file('noise') }));
  assert.ok(mods(written).every((m) => !('code' in m) && m.ref === 'noise'));
});

test('a module naming no library module takes the ref of its current file; one naming one keeps it', () => {
  assert.equal(refs.write(look({ code: file('colour-wash') })).layers[0].modules[0].ref, 'colour-wash');
  assert.equal(refs.write(look({ ref: 'plasma', code: file('noise') })).layers[0].modules[0].ref, 'noise');
  const read = refs.read(look({ ref: 'fire', code: file('noise') }));
  assert.deepEqual(mods(read).map((m) => [m.ref, m.code]), [0, 1].map(() => ['fire', file('fire')]));
});

test('a ref the library lacks, whose code is no current file, keeps its ref and plays nothing', () => {
  const read = refs.read(look({ ref: 'plasma', code: `${file('noise')}\n// edited` }));
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
    // Saved while noise was its earlier file, mid-rebake (its bake has no hash yet); then the library changed.
    const saved = refs.write({ layers: layers(oldNoise), reviewed: true, reviewedBy: 'u2',
      bake: { status: 'running' } });
    assert.ok(saved.codeHash && !('code' in saved.layers[0].modules[0]));
    const busy = refs.read(saved);
    assert.deepEqual([busy.bake, busy.reviewed, busy.reviewedBy, busy.codeHash],
      [undefined, false, undefined, undefined]);
    const now = store.looks.create(baked(file('noise')));
    assert.equal(now.bake?.layersHash, layersHash(renderFields(now)));
    const shared = store.looks.update(now.id, { shared: true });
    assert.deepEqual([shared.bake?.ok, shared.reviewed], [true, true], 'a write without code keeps the bake current');
    assert.deepEqual(Object.keys(shared.layers[0].modules[0]), ['id', 'kind', 'title', 'ref', 'code', 'params']);
    await store.flush();
  });

test('a stored module keeps no code; a ref alone saves when the library has it', async () => {
  const app = await startApp({ publicDir, dataDir: path.join(fx.tmp, 'refs') });
  try {
    const ann = await signup(app, 'ann');
    const old = git('1cfdcda6:public/patterns/noise.js');
    const made = await ann.post('/api/looks', { title: 'Old noise', chain: 2, layers: [{ id: 'l1', title: 'Noise',
      blend: 'add', level: 1, groups: ['cathedral'], modules: [{ id: 'm1', kind: 'source', ref: 'noise', code: old,
        title: 'Noise', params: {} }] }] });
    assert.equal(made.status, 201, made.text);
    const m = (await ann.get(`/api/looks/${made.json.look.id}`)).json.look.layers[0].modules[0];
    assert.deepEqual([m.ref, m.code], ['noise', file('noise')]);
    await app.store.flush();
    const stored = JSON.parse(readFileSync(path.join(fx.tmp, 'refs', 'looks.json'), 'utf8'));
    assert.ok(!('code' in stored[0].layers[0].modules[0]), 'the stored module keeps no code');
    const refOnly = (ref) => ann.post('/api/looks', { title: ref, chain: 2, layers: [{ id: 'l1', title: 'L',
      blend: 'add', level: 1, groups: ['cathedral'], modules: [{ id: 'm1', kind: 'source', ref, title: 'M' }] }] });
    const r = await refOnly('noise');
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.look.layers[0].modules[0].code, file('noise'));
    for (const ref of ['tendril', 'no-such-pattern']) assert.equal((await refOnly(ref)).status, 403, ref);
  } finally {
    await app.close();
  }
});
