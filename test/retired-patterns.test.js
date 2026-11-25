// The library-only step on looks using retired patterns, against the real library: butterfly-, plasma- and
// lighthouse-classic switch to their presets' modules, keeping the params that fit; a layer holding tendril or
// stained-glass goes, the look kept. The looks mirror the owner's that use them, stored as refs or as code.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, test } from 'vitest';

import { changeLines, migrateLibraryOnly } from '../src/library-only-data.ts';
import { fx, quiet, useFixture } from './fixtures/server.js';

useFixture();
const patternsDir = fileURLToPath(new URL('../public/patterns/', import.meta.url));
const file = (name) => readFileSync(path.join(patternsDir, `${name}.js`), 'utf8');
const src = (id, ref, params = {}, extra = {}) => ({ id, kind: 'source', title: ref, ref, params, ...extra });
const look = (id, title, layers, extra = {}) => ({ id, owner: 'u1', title, createdAt: 'x', updatedAt: 'x', layers,
  reviewed: true, reviewedBy: 'cat', bake: { status: 'done', layersHash: 'h' }, ...extra });
const LOOKS = [
  look('coral', 'Coral Garden', [
    { id: 'l1', title: 'Wings', modules: [src('m1', 'butterfly-classic', { colours: 'body accent', speed: 1.2,
      scale: 3 }, { blend: 'over' }), { id: 'm2', kind: 'filter', title: 'Hue', ref: 'hue-shift', on: 'm1',
      params: {} }] },
    { id: 'l2', title: 'Tendrils', modules: [src('m1', 'tendril')] },
  ]),
  look('masonry', 'Jewelled Masonry', [
    { id: 'l1', title: 'Glass', modules: [src('m1', 'colour-wash'), { id: 'm2', kind: 'filter', title: 'Glass',
      ref: 'stained-glass', params: {} }] },
    { id: 'l2', title: 'Embers', modules: [src('m1', 'fire')] },
  ]),
  // Stored with code, as a folder that never had the step holds it.
  look('disco1', 'Prismatic Disco v1', [{ id: 'l1', title: 'Plasma', modules: [
    src('m1', 'plasma-classic', { colours: 'all', size: 2 }, { code: 'old plasma' }),
    src('m2', 'sparkle', {}, { code: `${file('sparkle')}// edited` })] }]),
  look('disco2', 'Prismatic Disco v2', [{ id: 'l1', title: 'Beams', modules: [
    src('m1', 'lighthouse-classic', { colours: 'high', beams: 4, spin: 0.5 })] }],
  { versions: [{ n: 1, layers: [{ id: 'l1', modules: [src('m1', 'plasma', { colours: 'low' })] }], reviewed: true }] }),
  look('disco3', 'Prismatic Disco v3', [{ id: 'l1', title: 'Mix', modules: [{ id: 'c1', kind: 'composite',
    title: 'Both', layers: [{ id: 's1', title: '', modules: [src('m1', 'butterfly-classic')] },
      { id: 's2', title: '', modules: [src('m1-turbulence', 'noise')] },
      { id: 's3', title: 'One', ref: 'plasma-classic', params: { colours: 'low' } }] }] }]),
];

let dataDir, n = 0;
beforeEach(() => {
  dataDir = path.join(fx.tmp, `retired-${++n}`);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, 'looks.json'), JSON.stringify(LOOKS));
});
const run = (dryRun) => migrateLibraryOnly({ dataDir, patternsDir, dryRun, log: quiet });
const stored = () => Object.fromEntries(JSON.parse(readFileSync(path.join(dataDir, 'looks.json'), 'utf8'))
  .map((l) => [l.id, l]));
const brief = (modules) => modules.map((m) => [m.id, m.ref, m.on, m.blend].filter(Boolean).join(' '));

test('the dry run lists each look changed and how, apart from edited copies, and changes nothing', async () => {
  const r = await run(true);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.changes.flatMap(changeLines), [
    'coral "Coral Garden" (u1): Layer 1 (Wings): butterfly-classic is now the Butterfly preset (bars, turbulence, '
      + 'mirror), keeping colours',
    'coral "Coral Garden" (u1): Layer 2 (Tendrils) dropped: tendril has no match in the library',
    'masonry "Jewelled Masonry" (u1): Layer 1 (Glass) dropped: stained-glass has no match in the library',
    'disco1 "Prismatic Disco v1" (u1): Layer 1 (Plasma): plasma-classic is now the Plasma preset (bars, '
      + 'turbulence), keeping colours',
    'disco1 "Prismatic Disco v1" (u1): sparkle (sparkle) held an edited or earlier copy; it plays as the library\'s',
    'disco2 "Prismatic Disco v2" (u1): Layer 1 (Beams): lighthouse-classic is now the Lighthouse preset (bars), '
      + 'keeping colours, beams',
    'version 1 of disco2 "Prismatic Disco v2" (u1): Layer 1: plasma is now the Plasma preset (bars, turbulence), '
      + 'keeping colours',
    'disco3 "Prismatic Disco v3" (u1): Layer 1 (Mix): butterfly-classic is now the Butterfly preset (bars, '
      + 'turbulence, mirror)',
    'disco3 "Prismatic Disco v3" (u1): Layer 1 (Mix): One is now the Plasma preset (bars, turbulence), keeping '
      + 'colours',
  ]);
  assert.deepEqual(Object.values(stored()), LOOKS);
});

test('applied: the switched modules, their params, the dropped layers, and fresh bakes and reviews', async () => {
  const r = await run(false);
  assert.equal(r.rebaked, 5);
  const looks = stored();
  const [wings] = looks.coral.layers;
  assert.deepEqual(looks.coral.layers.map((l) => l.id), ['l1'], 'the tendril layer went, the look kept');
  assert.deepEqual(brief(wings.modules), ['m1 bars over', 'm1-turbulence turbulence m1', 'm1-mirror mirror m1',
    'm2 hue-shift m1'], 'the preset\'s warps attach to its source, ahead of what was attached');
  assert.deepEqual(wings.modules[0].params, { direction: 'right', profile: 'smooth', bars: 16, speed: 0.3,
    colours: 'body accent' });
  assert.deepEqual(wings.modules.slice(0, 3).map((m) => [m.kind, m.title]), [['source', 'Bars'],
    ['warp', 'Turbulence'], ['warp', 'Mirror']]);
  assert.ok(wings.modules.every((m) => !('code' in m)), 'stored as refs, they stay refs');
  assert.deepEqual([looks.coral.bake, looks.coral.reviewed, looks.coral.reviewedBy], [undefined, false, undefined]);
  assert.deepEqual(looks.masonry.layers.map((l) => l.title), ['Embers']);
  const disco1 = looks.disco1.layers[0].modules;
  assert.deepEqual(brief(disco1), ['m1 bars', 'm1-turbulence turbulence m1', 'm2 sparkle']);
  assert.deepEqual(disco1.map((m) => m.code), [file('bars'), file('turbulence'), file('sparkle')],
    'stored as code, they carry the library\'s');
  const beams = looks.disco2.layers[0].modules;
  assert.deepEqual(beams[0].params, { colours: 'high', direction: 'orbit-counterclockwise', profile: 'comet',
    bars: 4, duty: 0.6, speed: 0.4 }, 'Beams counts the bars; Spin, another measure, does not carry');
  assert.deepEqual(brief(looks.disco2.versions[0].layers[0].modules), ['m1 bars', 'm1-turbulence turbulence m1']);
  assert.equal(looks.disco2.versions[0].reviewed, undefined);
  const subs = looks.disco3.layers[0].modules[0].layers;
  assert.deepEqual(subs.map((s) => brief(s.modules)), [['m1 bars', 'm1-turbulence-2 turbulence m1',
    'm1-mirror mirror m1'], ['m1-turbulence noise'], ['m1-2 bars', 'm1-2-turbulence turbulence m1-2']],
  'ids stay unique across the layer; a sub-layer that is one source becomes a chain');
  assert.equal(subs[2].title, 'One');
  assert.deepEqual(await run(false), { done: true });
});

test('a switch that takes a chain past 8 modules drops its layer', async () => {
  const many = [src('m1', 'butterfly-classic'), ...[2, 3, 4, 5, 6, 7].map((i) => src(`m${i}`, 'noise'))];
  writeFileSync(path.join(dataDir, 'looks.json'), JSON.stringify([look('full', 'Full', [{ id: 'l1', title: 'Full',
    modules: many }])]));
  const r = await run(true);
  assert.deepEqual(r.changes.flatMap(changeLines), ['full "Full" (u1): Layer 1 (Full) dropped: the switch takes it '
    + 'past 8 modules']);
});
