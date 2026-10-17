// cathedral.json: shape, agreement with the canonical CSV and views, and freshness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = (p) => new URL(p, import.meta.url);
const text = readFileSync(here('../public/data/cathedral.json'), 'utf8');
const cat = JSON.parse(text);
const csvLines = readFileSync(here('../../td/data/all-pixels-positions.csv'), 'utf8').trim().split(/\r?\n/);
const header = csvLines[0].split(',');
const rows = csvLines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [header[i], v])));

test('top-level shape', () => {
  assert.equal(cat.version, 1);
  assert.equal(cat.count, 4870);
  assert.equal(cat.channelsPerUniverse, 510);
  assert.equal(cat.universes, 80);
  for (const k of ['zone', 'strand', 'universe', 'channel', 'row']) assert.equal(cat.pixels[k].length, cat.count, k);
  assert.equal(cat.pixels.pos.length, cat.count * 3);
  assert.ok(text.length < 400_000, `compact (${text.length} bytes)`);
});

test('every LED agrees with td/data/all-pixels-positions.csv', () => {
  assert.equal(rows.length, cat.count);
  const zones = [...new Set(rows.map((r) => r.zone))];
  assert.deepEqual(cat.zones, zones, 'zones in CSV order');
  rows.forEach((r, k) => {
    assert.equal(cat.zones[cat.pixels.zone[k]], r.zone, `zone ${k}`);
    assert.equal(cat.pixels.universe[k], +r.universe, `universe ${k}`);
    assert.equal(cat.pixels.channel[k], +r.channel, `channel ${k}`);
    assert.equal(cat.pixels.row[k], r.row === '' ? 0 : +r.row, `row ${k}`);
    for (const [i, col] of ['cat_x', 'cat_y', 'cat_z'].entries()) {
      assert.ok(Math.abs(cat.pixels.pos[3 * k + i] - +r[col]) <= 0.0006, `${col} ${k}`);
    }
  });
});

test('bounds hold every LED', () => {
  for (let i = 0; i < 3; i++) {
    const v = cat.pixels.pos.filter((_, j) => j % 3 === i);
    assert.equal(Math.min(...v), cat.bounds.min[i]);
    assert.equal(Math.max(...v), cat.bounds.max[i]);
  }
});

test('strands are contiguous, cover every LED, one zone each', () => {
  let next = 0;
  cat.strands.forEach((s, i) => {
    assert.equal(s.start, next, `strand ${i} starts where the last ended`);
    assert.ok(s.count > 0 && typeof s.name === 'string' && s.name);
    for (let k = s.start; k < s.start + s.count; k++) {
      assert.equal(cat.pixels.strand[k], i);
      assert.equal(cat.pixels.zone[k], s.zone);
    }
    next += s.count;
  });
  assert.equal(next, cat.count);
  const names = cat.strands.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, 'strand names are unique');
  assert.deepEqual(names.slice(0, 5), ['Main arch 1', 'Main arch 2', 'Main arch 3', 'Main arch 4', 'Main arch 5']);
  assert.ok(names.includes('Rose petal 07'));
  assert.ok(names.includes('Mini arch left 3'));
  // Each rose petal is one strand of 14 cells.
  for (const s of cat.strands.filter((x) => x.name.startsWith('Rose petal'))) assert.equal(s.count, 14);
  // Each spire has 8 strands of 13.
  assert.equal(cat.strands.filter((x) => x.name.startsWith('Spire ')).length, 32);
});

test('groups: unique ids, a tree, the SPEC minimum', () => {
  const ids = cat.groups.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(cat.groups[0].id, 'cathedral');
  assert.equal(cat.groups[0].parent, null);
  assert.deepEqual(cat.groups[0].zones, cat.zones);
  const byId = new Map(cat.groups.map((g) => [g.id, g]));
  for (const g of cat.groups) {
    if (g.parent !== null) assert.ok(byId.has(g.parent), g.id);
    assert.ok(g.zones || g.strands, `${g.id} has members`);
    for (const z of g.zones || []) assert.ok(cat.zones.includes(z), `${g.id}: zone ${z}`);
    for (const s of g.strands || []) assert.ok(s >= 0 && s < cat.strands.length, `${g.id}: strand ${s}`);
  }
  const children = (id) => cat.groups.filter((g) => g.parent === id).map((g) => g.id);
  assert.deepEqual(children('cathedral'), ['arches', 'spires', 'spirelets', 'rose-window', 'canopy', 'wash']);
  assert.deepEqual(children('arches'), ['main-arches', 'mini-arches', 'quad-arches']);
  assert.equal(children('main-arches').length, 5);
  assert.deepEqual(children('mini-arches'), ['mini-arches-left', 'mini-arches-right']);
  assert.equal(children('mini-arches-left').length, 5);
  assert.equal(children('mini-arches-right').length, 5);
  assert.equal(children('quad-arches').length, 6);
  assert.equal(children('spires').length, 4);
  const rose = children('rose-window');
  assert.equal(rose.filter((id) => id.startsWith('rose-petal-')).length, 16);
  for (let r = 1; r <= 7; r++) {
    const ring = byId.get(`rose-ring-${r}`);
    assert.deepEqual(ring.rows, [r]);
    assert.equal(ring.zones.length, 16);
  }
});

test('views are td/config/views.json verbatim', () => {
  const views = JSON.parse(readFileSync(here('../../td/config/views.json'), 'utf8')).views;
  assert.deepEqual(cat.views, views);
});

test('cathedral.json is fresh (build_cathedral.py --check)', (t) => {
  const script = fileURLToPath(here('../tools/build_cathedral.py'));
  const run = spawnSync('python3', [script, '--check'], { encoding: 'utf8' });
  if (run.error && run.error.code === 'ENOENT') { t.skip('python3 not available'); return; }
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});
