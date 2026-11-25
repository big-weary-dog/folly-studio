// The library-only step on a data folder: what it keeps, moves and drops, its backups, its marker, the dry run, and
// that the server never runs it. A small library of its own: a current pattern with an earlier copy, a retired one
// (dropped: only the index's modules are library).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, test } from 'vitest';

import { layersHash, renderFields } from '../src/bake.ts';
import { MARKER, migrateLibraryOnly } from '../src/library-only-data.ts';
import { lockDataDir } from '../src/store-lock.ts';
import { quiet } from './fixtures/quiet.js';
import { fx, startApp, useFixture } from './fixtures/server.js';

useFixture();
const sha = (code) => createHash('sha256').update(code).digest('hex');
const WAVE = 'function pixel(p, t) { return [t, 0, 0]; }', OLD_WAVE = 'function pixel(p, t) { return [0, t, 0]; }';
const RETIRED = 'function pixel(p) { return [p.x, 0, 0]; }', CUSTOM = 'function pixel() { return [1, 1, 1]; }';
const mod = (code, extra = {}) => ({ id: 'm1', kind: 'source', title: 'M', code, params: {}, ...extra });
const look = (id, modules, extra = {}) => ({ id, owner: 'u1', title: id, createdAt: 'x', updatedAt: 'x',
  layers: [{ id: 'l1', title: '', modules }], ...extra });
const composite = (inner) => ({ id: 'c1', kind: 'composite', title: 'C', code: '', params: {},
  layers: [{ id: 's1', title: '', modules: [inner] }] });

let patternsDir, dataDir, n = 0;
beforeEach(() => {
  const root = path.join(fx.tmp, `library-only-${++n}`);
  patternsDir = path.join(root, 'patterns');
  dataDir = path.join(root, 'data');
  mkdirSync(patternsDir, { recursive: true });
  mkdirSync(path.join(dataDir, 'frames'), { recursive: true });
  writeFileSync(path.join(patternsDir, 'index.json'), JSON.stringify([{ name: 'wave', kind: 'source' }]));
  writeFileSync(path.join(patternsDir, 'wave.js'), WAVE);
  writeFileSync(path.join(patternsDir, 'history.json'), JSON.stringify({ wave: [sha(WAVE), sha(OLD_WAVE)],
    gone: [sha(RETIRED)] }));
});
const write = (name, items) => writeFileSync(path.join(dataDir, `${name}.json`), JSON.stringify(items));
const read = (name) => JSON.parse(readFileSync(path.join(dataDir, `${name}.json`), 'utf8'));
const run = (opts = {}) => migrateLibraryOnly({ dataDir, patternsDir, dryRun: false, log: quiet, ...opts });

test('keeps library code on the current library, drops looks and versions with any other', async () => {
  write('looks', [
    look('current', [mod(WAVE, { ref: 'wave' })]),
    look('older', [mod(OLD_WAVE, { ref: 'wave' })], { ideaId: 'i1' }),
    look('unnamed', [mod(OLD_WAVE)]),
    look('retired', [mod(RETIRED, { ref: 'gone' })]),
    look('nested', [composite(mod(OLD_WAVE, { id: 's1.m1', ref: 'wave' }))]),
    look('one-source', [], { layers: [{ id: 'l1', title: '', code: OLD_WAVE, params: {} }] }),
    look('edited', [mod(`${WAVE} `, { ref: 'wave' })]),
    look('spoofed', [mod(RETIRED, { ref: 'wave' })]),
    look('renamed', [mod(OLD_WAVE, { ref: 'wave-before' })]),
    look('ref-only', [{ ...mod(), ref: 'wave' }], { versions: [{ n: 1, layers: look('', [{ ...mod(), ref: 'wave' }])
      .layers }] }),
    look('ref-retired', [{ ...mod(), ref: 'gone' }]),
    look('custom', [mod(CUSTOM)]),
    look('custom-inside', [composite(mod(CUSTOM, { id: 's1.m1' }))]),
    look('versions', [mod(WAVE, { ref: 'wave' })], { versions: [
      { title: 'v1', layers: look('', [mod(OLD_WAVE)]).layers },
      { title: 'v2', layers: look('', [mod(CUSTOM)]).layers },
      { n: 3, title: 'v3', layers: look('', [mod(WAVE)]).layers }] }),
  ]);
  writeFileSync(path.join(dataDir, 'frames', 'custom.fseq'), 'x');
  writeFileSync(path.join(dataDir, 'frames', 'current.fseq'), 'x');
  const r = await run();
  assert.deepEqual(r.dropped.map((d) => [d.look, d.version, d.why]), [['retired', undefined, 'retired pattern gone'],
    ['edited', undefined, 'custom code (M)'], ['spoofed', undefined, 'retired pattern gone'],
    ['ref-retired', undefined, 'retired pattern gone'],
    ['custom', undefined, 'custom code (M)'], ['custom-inside', undefined, 'custom code (M)'],
    ['versions', 2, 'custom code (M)']]);
  const looks = Object.fromEntries(read('looks').map((l) => [l.id, l]));
  const first = (id) => looks[id].layers[0].modules?.[0] ?? looks[id].layers[0];
  for (const id of ['current', 'older', 'unnamed', 'renamed']) {
    assert.deepEqual([first(id).ref, first(id).code], ['wave', WAVE]);
  }
  // Stored as a ref alone (as the server keeps a module): kept as it is, its version too.
  assert.deepEqual([first('ref-only').ref, 'code' in first('ref-only')], ['wave', false]);
  assert.equal(looks['ref-only'].versions[0].layers[0].modules[0].ref, 'wave');
  assert.equal(first('nested').layers[0].modules[0].code, WAVE);
  assert.equal(first('one-source').code, WAVE);
  assert.ok(!('ideaId' in looks.older));
  // Numbered, so the kept ones keep theirs; on the current library too.
  assert.deepEqual(looks.versions.versions.map((v) => [v.n, v.layers[0].modules[0].code]), [[1, WAVE], [3, WAVE]]);
  assert.ok(!existsSync(path.join(dataDir, 'frames', 'custom.fseq')));
  assert.ok(existsSync(path.join(dataDir, 'frames', 'current.fseq')));
});

test('drops a look with a malformed composite: code of its own, of any kind, or no sub-layers', async () => {
  const inner = composite(mod(WAVE, { id: 's1.m1', ref: 'wave' }));
  write('looks', [look('code', [{ ...inner, code: WAVE }]), look('null', [{ ...inner, code: null }]),
    look('zero', [{ ...inner, code: 0 }]), look('empty', [{ ...inner, layers: [] }]), look('fine', [inner])]);
  const r = await run();
  assert.deepEqual(r.dropped.map((d) => [d.look, d.why]), [['code', 'a composite with code'],
    ['null', 'a composite with code'], ['zero', 'a composite with code'], ['empty', 'a malformed composite']]);
  assert.deepEqual(read('looks').map((l) => l.id), ['fine']);
});

test('a look whose code moved loses its bake, frames and review; the look keeps its number', async () => {
  const reviewed = { bake: { status: 'done', layersHash: 'h' }, reviewed: true, reviewedBy: 'cat', flashOverride: {} };
  const v = (code, extra = {}) => ({ title: 'v', layers: look('', [mod(code, { ref: 'wave' })]).layers, ...extra });
  write('looks', [
    look('moved', [mod(OLD_WAVE, { ref: 'wave' })], { ...reviewed,
      versions: [v(OLD_WAVE, { reviewed: { by: 'cat' } }), v(WAVE, { reviewed: { by: 'cat' } }), v(CUSTOM)] }),
    look('same', [mod(WAVE, { ref: 'wave' })], reviewed),
    look('named', [mod(WAVE)], { ...reviewed, bake: { status: 'done',
      layersHash: layersHash(renderFields(look('', [mod(WAVE)]))) } }),
  ]);
  for (const id of ['moved', 'same']) writeFileSync(path.join(dataDir, 'frames', `${id}.fseq`), 'x');
  const r = await run();
  assert.deepEqual(r.dropped.map((d) => [d.look, d.version]), [['moved', 3]]);
  const [moved, same, named] = read('looks');
  assert.equal(named.bake.layersHash, layersHash(renderFields(named)), 'naming the ref keeps the bake');
  assert.equal(named.reviewed, true);
  assert.deepEqual([moved.bake, moved.reviewed, moved.reviewedBy, moved.flashOverride], [undefined, false,
    undefined, undefined]);
  assert.deepEqual(moved.versions.map((x) => [x.n, x.reviewed]), [[1, undefined], [2, { by: 'cat' }]]);
  assert.deepEqual(moved.version, { n: 4 }, 'it was 4 before version 3 went, and stays 4');
  assert.deepEqual([same.bake, same.reviewed, same.reviewedBy], [reviewed.bake, true, 'cat']);
  assert.ok(!existsSync(path.join(dataDir, 'frames', 'moved.fseq')));
  assert.ok(existsSync(path.join(dataDir, 'frames', 'same.fseq')));
});

test('backs up first, strips the AI grants, then is done: a second run changes nothing', async () => {
  const looks = [look('custom', [mod(CUSTOM)])];
  const users = [{ id: 'u1', username: 'ann', access: { models: ['sol'] } }, { id: 'u2', username: 'bob' }];
  write('looks', looks);
  write('users', users);
  const r = await run({ now: new Date('2026-11-25T10:00:00.123Z') });
  assert.equal(r.grants, 1);
  assert.deepEqual(r.backups.map((f) => path.basename(f)), ['looks.pre-library-only-2026-11-25T10-00-00Z.json',
    'users.pre-library-only-2026-11-25T10-00-00Z.json']);
  assert.deepEqual(JSON.parse(readFileSync(r.backups[0], 'utf8')), looks);
  assert.deepEqual(JSON.parse(readFileSync(r.backups[1], 'utf8')), users);
  assert.deepEqual([read('looks'), read('users')], [[], [{ id: 'u1', username: 'ann' }, users[1]]]);
  assert.equal(read('migrations')['library-only'], '2026-11-25T10:00:00.123Z');
  write('looks', looks); // were it to run again, it would drop this
  assert.deepEqual(await run(), { done: true });
  assert.deepEqual(read('looks'), looks);
});

test('--dry-run writes nothing; a folder in use, or one whose backup fails, is left as it was', async () => {
  const looks = [look('custom', [mod(CUSTOM)])];
  write('looks', looks);
  const before = readdirSync(dataDir).sort();
  const dry = await run({ dryRun: true });
  assert.deepEqual(dry.dropped.map((d) => d.look), ['custom']);
  assert.deepEqual(readdirSync(dataDir).sort(), before);
  const nowhere = path.join(dataDir, 'nowhere');
  assert.deepEqual((await run({ dataDir: nowhere, dryRun: true })).dropped, []);
  assert.ok(!existsSync(nowhere));
  const lock = await lockDataDir(dataDir);
  await assert.rejects(run(), /studio\.lock|another|in use/i);
  await lock.release();
  const now = new Date('2026-11-25T10:00:00Z');
  writeFileSync(path.join(dataDir, 'looks.pre-library-only-2026-11-25T10-00-00Z.json'), 'kept');
  await assert.rejects(run({ now }), /EEXIST/);
  assert.deepEqual(read('looks'), looks);
  assert.ok(!existsSync(path.join(dataDir, MARKER)));
});

test('a library file it cannot read stops it before anything changes', async () => {
  const looks = [look('older', [mod(OLD_WAVE, { ref: 'wave' })])], users = [{ id: 'u1', access: {} }];
  write('looks', looks);
  write('users', users);
  // Broken, and unreadable (a folder in its place): a missing pattern file would count as retired.
  for (const [file, body] of [['history.json', '{'], ['wave.js', null]]) {
    const at = path.join(patternsDir, file), was = readFileSync(at, 'utf8');
    if (body === null) {
      rmSync(at);
      mkdirSync(at);
    } else {
      writeFileSync(at, body);
    }
    await assert.rejects(run());
    rmSync(at, { recursive: true });
    writeFileSync(at, was);
    assert.deepEqual([read('looks'), read('users'), existsSync(path.join(dataDir, MARKER))], [looks, users, false]);
    assert.deepEqual(readdirSync(dataDir).filter((n) => n.includes('.pre-')), []);
  }
});

test('without the library it leaves the folder for a later start', async () => {
  write('looks', [look('current', [mod(WAVE, { ref: 'wave' })])]);
  const r = await run({ patternsDir: path.join(fx.tmp, 'nowhere') });
  assert.equal(r.done, false);
  assert.ok(!existsSync(path.join(dataDir, MARKER)));
});

test('the server never runs it: a start leaves the stored looks as they were', async () => {
  const publicDir = path.dirname(patternsDir);
  write('looks', [look('kept', [mod(OLD_WAVE, { ref: 'wave' })]), look('custom', [mod(CUSTOM)])]);
  const app = await startApp({ publicDir, dataDir });
  try {
    assert.ok(!existsSync(path.join(dataDir, MARKER)));
    assert.deepEqual(read('looks').map((l) => [l.id, l.layers[0].modules[0].code]), [['kept', OLD_WAVE],
      ['custom', CUSTOM]]);
  } finally {
    await app.close();
  }
});

test('a dry run is the default', async () => {
  write('looks', [look('custom', [mod(CUSTOM)])]);
  const r = await migrateLibraryOnly({ dataDir, patternsDir, log: quiet });
  assert.deepEqual(r.dropped.map((d) => d.look), ['custom']);
  assert.deepEqual(read('looks').map((l) => l.id), ['custom']);
  assert.ok(!existsSync(path.join(dataDir, MARKER)));
});
