// Venue mesh generation: finite triangles wound to face the courtyard.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { test } from 'vitest';

import { STRIDE, venueMesh } from '../public/js/playa/venue.ts';
import { frameOf } from '../public/js/viewer.ts';

const here = (p) => new URL(p, import.meta.url);
const read = (p) => JSON.parse(readFileSync(here(p), 'utf8'));
const VENUE = read('../public/data/venue.json'), COG = read('../public/data/rig.json');

   // the strips' drawn radius, metres: a prop this near an LED would hide it

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
