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

test('the venue names City of Gods and stays clear of its LEDs', () => {
  assert.equal(VENUE.rig, COG.name);
  const { min, max } = COG.bounds;
  for (const b of VENUE.boxes) {
    if (b.id === 'turf') continue;
    const apart = [0, 1, 2].some((i) => b.max[i] <= min[i] || b.min[i] >= max[i]);
    assert.ok(apart, `${b.id} overlaps the rig`);
  }
  assert.ok(VENUE.boxes.find((b) => b.id === 'turf').max[1] < min[1], 'the turf lies under the lowest LED');
  assert.ok(!('venue' in COG) && !JSON.stringify(COG.groups).includes('venue'), 'the rig knows nothing of it');
});

test('the mesh is finite triangles; a wall is one plane, facing the courtyard', () => {
  const T = frameOf(COG.axes), { mesh, solid } = venueMesh(VENUE, T);
  assert.ok(mesh.length > 0 && mesh.length % (3 * STRIDE) === 0 && mesh.every(Number.isFinite));
  assert.equal(mesh.length / STRIDE - solid, 6, 'the turf last: one plane');
  const wall = { ...VENUE, boxes: VENUE.boxes.filter((b) => b.id === 'wall-left'), rails: [] };
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
