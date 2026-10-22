// rig-folly.json (the Folly's playa build): shape, views and Mirage's geometry; both rigs fresh from lighting, on
// the channels lighting drives (tools/check_channels.py), and palettes.json fresh.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import { prepareScene } from '../public/js/pattern-core.ts';
import { missingLighting } from './fixtures/sources.js';

const here = (p) => new URL(p, import.meta.url);
const text = readFileSync(here('../public/data/rig-folly.json'), 'utf8');
const rig = JSON.parse(text);

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

test('views are tools/data/views.json verbatim', () => {
  const views = JSON.parse(readFileSync(here('../tools/data/views.json'), 'utf8')).views;
  assert.deepEqual(rig.views, views);
});

const LIGHTING = ['city-of-gods/pixel-map/out', 'city-of-gods/xlights-show', 'show-builder/pixel-map',
  'show-builder/xlights', 'falcon-backups'];
const python = (skip, ...args) => {
  const why = missingLighting(...LIGHTING);
  skip(!!why, why);
  const run = spawnSync('python3', ['-B', fileURLToPath(here(`../tools/${args[0]}`)), ...args.slice(1)],
    { encoding: 'utf8' });
  skip(run.error?.code === 'ENOENT', 'python3 not available');
  return run;
};

test('the rigs are fresh from lighting (build_rig.py --check)', ({ skip }) => {
  const run = python(skip, 'build_rig.py', '--check');
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});

test('the rigs are on the channels lighting drives: xLights, the Falcon (check_channels.py)', ({ skip }) => {
  const run = python(skip, 'check_channels.py');
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
