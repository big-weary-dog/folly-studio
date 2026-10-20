// The venue's props are scenery for the 3D view alone: they name City of Gods, sit round it without touching an LED,
// build into finite triangles wound to face the courtyard, and nothing outside the view reads them.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

import { STRIDE, venueMesh } from '../public/js/playa/venue.ts';
import { frameOf } from '../public/js/viewer.ts';

const here = (p) => new URL(p, import.meta.url);
const read = (p) => JSON.parse(readFileSync(here(p), 'utf8'));
const VENUE = read('../public/data/venue.json'), COG = read('../public/data/rig.json');

const LEDS = Array.from({ length: COG.count }, (_, i) => COG.pixels.pos.slice(3 * i, 3 * i + 3));
const TUBE = 0.15;   // the strips' drawn radius, metres: a prop this near an LED would hide it

test('the venue names City of Gods and hides none of its LEDs', () => {
  assert.equal(VENUE.rig, COG.name);
  for (const b of VENUE.boxes.filter((x) => x.id !== 'turf')) {
    const hidden = LEDS.filter((p) => [0, 1, 2].every((i) => p[i] > b.min[i] - TUBE && p[i] < b.max[i] + TUBE));
    assert.equal(hidden.length, 0, `${b.id} buries ${hidden.length} LEDs`);
  }
  assert.ok(VENUE.boxes.find((b) => b.id === 'turf').max[1] < COG.bounds.min[1], 'the turf lies under the lowest LED');
  assert.ok(!('venue' in COG) && !JSON.stringify(COG.groups).includes('venue'), 'the rig knows nothing of it');
});

test('each mini arch stands across a dock\'s edge, the wall just outside it', () => {
  const minis = COG.fixtures.filter((f) => f.zone.startsWith('mini-arch'));
  assert.equal(minis.length, 2);
  for (const f of minis) {
    const z = LEDS.slice(f.start, f.start + f.count).map((p) => p[2]);
    const [lo, hi] = [Math.min(...z), Math.max(...z)], left = hi < 0, outer = left ? lo : hi;
    const wall = VENUE.boxes.find((b) => b.id === (left ? 'wall-left' : 'wall-right')).min[2];
    assert.ok(Math.abs(wall - outer) < 0.5, `${f.id}: the wall ${Math.abs(wall - outer)} m from its outer side`);
    const docks = VENUE.boxes.filter((b) => b.id.startsWith(left ? 'dock-left' : 'dock-right'));
    for (const d of docks) {
      const edge = left ? d.max[2] : d.min[2];
      assert.ok(edge > lo && edge < hi, `${d.id}: its edge between ${f.id}'s legs`);
    }
  }
});

test('a 6 ft bay by each tower runs to the wall and holds its outer spirelet, from the dock', () => {
  const lone = COG.fixtures.filter((f) => f.kind === 'flood' && f.count === 1).map((f) => LEDS[f.start]);
  const towerZ = new Set(COG.structure.lines.flatMap((l) => [l[2], l[5]]));
  assert.equal(lone.length, 2);
  for (const p of lone) {
    const left = p[2] < 0, bay = VENUE.scaffold.find((s) => s.id === (left ? 'bay-left' : 'bay-right'));
    const wall = VENUE.boxes.find((b) => b.id === (left ? 'wall-left' : 'wall-right')).min[2];
    const [inner, outer] = left ? [bay.max[2], bay.min[2]] : [bay.min[2], bay.max[2]];
    assert.ok(Math.abs(Math.abs(outer - inner) - 1.83) < 0.01 && towerZ.has(inner), `${bay.id}: one bay off the tower`);
    assert.ok(Math.abs(wall - outer) < 0.5, `${bay.id}: ${Math.abs(wall - outer)} m short of the wall`);
    assert.ok([0, 2].every((i) => p[i] >= bay.min[i] - 0.05 && p[i] <= bay.max[i] + 0.05), `${bay.id} under it`);
    assert.ok(p[1] - bay.max[1] > 0 && p[1] - bay.max[1] < 0.3, `${bay.id}: its top just under the spirelet`);
    const back = VENUE.boxes.find((b) => b.id === (left ? 'dock-left-back' : 'dock-right-back'));
    assert.ok(inner > back.min[2] && inner < back.max[2], `${bay.id}: the pole off the tower rests on the dock`);
  }
});

test('the mesh is finite triangles; a wall is one plane, facing the courtyard', () => {
  const T = frameOf(COG.axes), { mesh, solid } = venueMesh(VENUE, T);
  assert.ok(mesh.length > 0 && mesh.length % (3 * STRIDE) === 0 && mesh.every(Number.isFinite));
  assert.equal(mesh.length / STRIDE - solid, 6, 'the turf last: one plane');
  const wall = { ...VENUE, boxes: VENUE.boxes.filter((b) => b.id === 'wall-left'), rails: [], scaffold: [] };
  const { mesh: m } = venueMesh(wall, T), v = (k) => [0, 1, 2].map((i) => m[k * STRIDE + i]);
  assert.equal(m.length, 6 * STRIDE, 'two triangles');
  const [a, b, c] = [v(0), v(1), v(2)], e1 = b.map((x, i) => x - a[i]), e2 = c.map((x, i) => x - a[i]);
  assert.ok(e1[0] * e2[1] - e1[1] * e2[0] > 0, 'wound counter-clockwise seen from +z, the courtyard');
  assert.equal(m[8], 5, 'it carries its windows\' bay');
});

test('the props are the view\'s alone: nothing else reads venue.json', () => {
  const root = here('../'), hits = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (f === 'node_modules' || f === 'dist') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs|py)$/.test(f) && readFileSync(p, 'utf8').includes('venue')) hits.push(p);
    }
  };
  for (const d of ['public/js', 'src', 'shared', 'pi', 'render-box', 'tools']) walk(new URL(d, root).pathname);
  const rel = hits.map((p) => path.relative(new URL('.', root).pathname, p)).sort();
  assert.deepEqual(rel, ['public/js/playa/renderer.ts', 'public/js/playa/venue.ts', 'public/js/ui/preview-view.tsx',
    'public/js/ui/preview.ts', 'public/js/viewer-gl.ts', 'public/js/viewer.ts']);
});
