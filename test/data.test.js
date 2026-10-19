// rig.json (the Folly's): shape, agreement with the canonical CSV, views and Mirage's geometry, and freshness.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import { prepareScene } from '../public/js/pattern-core.ts';

const here = (p) => new URL(p, import.meta.url);
const text = readFileSync(here('../public/data/rig.json'), 'utf8');
const rig = JSON.parse(text);
const csvLines = readFileSync(here('../../td/data/all-pixels-positions.csv'), 'utf8').trim().split(/\r?\n/);
const header = csvLines[0].split(',');
const rows = csvLines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [header[i], v])));
const zoneOf = (k) => rig.fixtures.find((f) => k >= f.start && k < f.start + f.count).zone;

test('top-level shape', () => {
  assert.equal(rig.rig, 1);
  assert.equal(rig.count, 4870);
  assert.deepEqual(rig.output, { protocol: 'sacn', universes: 80, channelsPerUniverse: 510, order: 'RGB', fps: 40 });
  assert.deepEqual(rig.axes, { up: '+y', front: '-x', right: '+z' });
  for (const k of ['universe', 'channel']) assert.equal(rig.pixels[k].length, rig.count, k);
  for (const k of ['ring', 'sector']) assert.equal(rig.pixels.attrs[k].length, rig.count, k);
  assert.equal(rig.pixels.pos.length, rig.count * 3);
  assert.ok(text.length < 400_000, `compact (${text.length} bytes)`);
  assert.doesNotThrow(() => prepareScene(rig));
});

test('every LED agrees with td/data/all-pixels-positions.csv', () => {
  assert.equal(rows.length, rig.count);
  rows.forEach((r, k) => {
    assert.equal(zoneOf(k), r.zone, `zone ${k}`);
    assert.equal(rig.pixels.universe[k], +r.universe, `universe ${k}`);
    assert.equal(rig.pixels.channel[k], +r.channel, `channel ${k}`);
    assert.equal(rig.pixels.attrs.ring[k], r.row === '' ? 0 : +r.row, `ring ${k}`);
    const petal = /^rose-petal-(\d+)$/.exec(r.zone);
    assert.equal(rig.pixels.attrs.sector[k], petal ? petal[1] - 1 : -1, `sector ${k}`);
    for (const [i, col] of ['cat_x', 'cat_y', 'cat_z'].entries()) {
      assert.ok(Math.abs(rig.pixels.pos[3 * k + i] - +r[col]) <= 0.0006, `${col} ${k}`);
    }
  });
});

test('bounds hold every LED', () => {
  for (let i = 0; i < 3; i++) {
    const v = rig.pixels.pos.filter((_, j) => j % 3 === i);
    assert.equal(Math.min(...v), rig.bounds.min[i]);
    assert.equal(Math.max(...v), rig.bounds.max[i]);
  }
});

test('fixtures: make_pixel_csv\'s chains, with Mirage\'s shapes', () => {
  const ids = rig.fixtures.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'fixture ids are unique');
  assert.deepEqual(ids.slice(0, 5), ['main-arch-1', 'main-arch-2', 'main-arch-3', 'main-arch-4', 'main-arch-5']);
  const of = (zone) => rig.fixtures.filter((f) => f.zone.startsWith(zone));
  assert.equal(of('spire-').length, 32, 'each spire has 8 strands');
  assert.ok(of('spire-').every((f) => f.count === 13 && f.kind === 'strip' && f.render.bulbs));
  assert.ok(of('rose-petal-').every((f) => f.count === 14 && f.kind === 'cells' && f.render.cells.length === 14));
  assert.ok(of('canopy').every((f) => f.render.sag === 1.5));
  assert.equal(of('main-arch')[0].render.radius, 0.15);
  // Rose cells are flat loops in the window's plane, round their pixel.
  const petal = of('rose-petal-01')[0];
  petal.render.cells.forEach((loop, i) => {
    assert.ok(loop.length >= 9 && loop.length % 3 === 0);
    const k = petal.start + i, xs = loop.filter((_, j) => j % 3 === 0);
    assert.ok(xs.every((x) => x === rig.pixels.pos[3 * k]), 'in the window plane');
    for (const a of [1, 2]) {
      const v = loop.filter((_, j) => j % 3 === a);
      assert.ok(Math.min(...v) < rig.pixels.pos[3 * k + a] && rig.pixels.pos[3 * k + a] < Math.max(...v));
    }
  });
  // Floods: 22 wash floods aimed up or down; spirelets solid cones standing on the scaffold.
  const wash = of('wash').flatMap((f) => f.render.cone.dirs);
  assert.equal(wash.length, 22);
  assert.ok(wash.every((d) => Math.abs(Math.hypot(...d) - 1) < 0.01 && Math.abs(d[1]) > 0.9));
  const cones = of('spirelet');
  assert.ok(cones.every((f) => f.kind === 'flood' && f.render.cone.solid && f.render.cone.apex.length === f.count));
  assert.ok(rig.structure.lines.length > 100 && rig.structure.lines.every((l) => l.length === 6));
});

test('groups: the tree saved looks name, with tags', () => {
  const ids = rig.groups.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(rig.groups[0], { id: 'cathedral', name: 'Cathedral', parent: null, tags: ['all'],
    zones: [...new Set(rig.fixtures.map((f) => f.zone))] });
  const byId = new Map(rig.groups.map((g) => [g.id, g]));
  const fixtures = new Set(rig.fixtures.map((f) => f.id));
  for (const g of rig.groups) {
    if (g.parent !== null) assert.ok(byId.has(g.parent), g.id);
    assert.ok(g.zones || g.fixtures || g.where, `${g.id} has members`);
    for (const f of g.fixtures || []) assert.ok(fixtures.has(f), `${g.id}: fixture ${f}`);
  }
  const children = (id) => rig.groups.filter((g) => g.parent === id).map((g) => g.id);
  assert.deepEqual(children('cathedral'), ['arches', 'spires', 'spirelets', 'rose-window', 'canopy', 'wash']);
  assert.deepEqual(children('arches'), ['main-arches', 'mini-arches', 'quad-arches']);
  assert.equal(children('main-arches').length, 5);
  assert.deepEqual(children('mini-arches'), ['mini-arches-left', 'mini-arches-right']);
  assert.equal(children('quad-arches').length, 6);
  assert.equal(children('spires').length, 4);
  assert.equal(children('rose-window').filter((id) => id.startsWith('rose-petal-')).length, 16);
  for (let r = 1; r <= 7; r++) assert.deepEqual(byId.get(`rose-ring-${r}`).where, { ring: [r] });
  const tagged = (tag) => rig.groups.filter((g) => g.tags?.includes(tag)).map((g) => g.id);
  assert.deepEqual(tagged('rose'), ['rose-window']);
  assert.deepEqual(tagged('tower'), ['spire-back-left', 'spire-back-right', 'spire-front-left', 'spire-front-right']);
  assert.deepEqual(tagged('arch-main'), ['main-arches']);
  assert.deepEqual(byId.get('rose-window').centre, [-8.567, 5.936, -0.443]);
});

test('views are td/config/views.json verbatim', () => {
  const views = JSON.parse(readFileSync(here('../../td/config/views.json'), 'utf8')).views;
  assert.deepEqual(rig.views, views);
});

test('rig.json is fresh (build_rig.py --check)', ({ skip }) => {
  const script = fileURLToPath(here('../tools/build_rig.py'));
  const run = spawnSync('python3', [script, '--check'], { encoding: 'utf8' });
  skip(run.error?.code === 'ENOENT', 'python3 not available');
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});

test('palettes.json is fresh (build_palettes.py --check), roles in order', ({ skip }) => {
  const pals = JSON.parse(readFileSync(here('../public/data/palettes.json'), 'utf8'));
  assert.deepEqual(pals.roles, ['low', 'body', 'accent', 'high']);
  assert.ok(pals.palettes.length >= 8 && pals.palettes.every((p) => p.body.length && p.low.length));
  const script = fileURLToPath(here('../tools/build_palettes.py'));
  const run = spawnSync('python3', [script, '--check'], { encoding: 'utf8' });
  skip(run.error?.code === 'ENOENT', 'python3 not available');
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});
