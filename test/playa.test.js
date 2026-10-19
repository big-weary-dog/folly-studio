// The Playa view's geometry comes from the rig's render hints alone: City of Gods, the Folly's rig and the fictional
// mini rig (z up, floods aimed up) all build, in the view frame, with nothing non-finite in what goes to the GPU.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { test } from 'vitest';

import { buildGeometry, cluster, earClip, playa } from '../public/js/playa/geometry.ts';
import { tooSlow } from '../public/js/playa/renderer.ts';
import { frameOf } from '../public/js/viewer.ts';

const rig = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const FOLLY = rig('../public/data/rig-folly.json');
const COG = rig('../public/data/rig.json');
const MINI = rig('./fixtures/rigs/mini.json');

function build(r) {
  const T = frameOf(r.axes), pos = new Float32Array(3 * r.count);
  for (let i = 0; i < r.count; i++) pos.set(T(r.pixels.pos, 3 * i), 3 * i);
  return { g: buildGeometry(r, pos, r.count, T, r.structure?.ground?.y ?? 0), pos, T };
}
const finite = (g) => ['strip', 'point', 'cell', 'beam', 'shell', 'line'].every((k) => g[k].every(Number.isFinite));
const pixels = (r, kind, test = () => true) => r.fixtures.filter((f) => f.kind === kind && test(f.render || {}))
  .reduce((n, f) => n + f.count, 0);

test('frameOf maps a rig\'s axes onto the view frame: x front → back, y up, z left → right', () => {
  assert.deepEqual(frameOf({ up: '+y', front: '-x', right: '+z' })([1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(frameOf({ up: '+z', front: '-y', right: '+x' })([1, 2, 3]), [2, 3, 1]);
  assert.deepEqual(frameOf({ up: '+y', front: '+z', right: '-x' })([1, 2, 3]), [-3, 2, -1]);
  assert.deepEqual(frameOf({ up: '+y', front: '+y', right: '+z' })([1, 2, 3]), [1, 2, 3], 'nonsense: identity');
});

test('the Folly builds: a ribbon per tube pixel, a globe per bulb, glass per cell, a cone per flood', () => {
  const { g } = build(FOLLY);
  assert.ok(finite(g));
  assert.equal(g.nstrip, pixels(FOLLY, 'strip', (r) => !r.bulbs));
  const floods = FOLLY.fixtures.filter((f) => f.kind === 'flood');
  const beams = floods.filter((f) => !f.render.cone.solid).reduce((n, f) => n + f.count, 0);
  assert.equal(g.npoint, pixels(FOLLY, 'strip', (r) => r.bulbs) + pixels(FOLLY, 'points') + beams, 'globes + lenses');
  assert.equal(g.nbeam, beams * 72);
  assert.equal(g.nshell, (pixels(FOLLY, 'flood') - beams) * 72);
  assert.ok(g.ncell >= pixels(FOLLY, 'cells') * 3 && g.ncell % 3 === 0, 'every cell triangulated');
  const wires = pixels(FOLLY, 'strip', (r) => r.bulbs) - FOLLY.fixtures.filter((f) => f.render?.bulbs).length;
  assert.equal(g.nline, 2 * (FOLLY.structure.lines.length + wires), 'scaffold, and wires between globes (vertices)');
  // A beam aimed down lights the playa near where it lands, not at the lens.
  const wash = floods.find((f) => !f.render.cone.solid);
  const k = wash.start + wash.render.cone.dirs.findIndex((d) => d[1] < -0.5);
  assert.ok(k >= wash.start && g.spill[3 * k + 1] < FOLLY.pixels.pos[3 * k + 1] / 2);
});

test('City of Gods builds: its spirelets stand on the towers as lit cones, no beams; the towers are scaffold', () => {
  const { g } = build(COG);
  assert.ok(finite(g));
  assert.equal(g.nbeam, 0);
  assert.equal(g.nshell, pixels(COG, 'flood') * 72);
  assert.equal(g.nstrip, pixels(COG, 'strip', (r) => !r.bulbs));
  assert.ok(COG.structure.lines.length > 0);
});

test('the mini rig builds in its own axes: upright posts, a sagging lintel, floods aimed up', () => {
  const { g, pos } = build(MINI);
  assert.ok(finite(g));
  const post = MINI.fixtures.find((f) => f.id === 'post-left'), lintel = MINI.fixtures.find((f) => f.id === 'lintel');
  assert.ok(pos[3 * (post.start + post.count - 1) + 1] > pos[3 * post.start + 1] + 2, 'up is +y in the view');
  const ribbon = (k) => g.strip.subarray(64 * k, 64 * k + 16);
  const mid = (k) => (ribbon(k)[1] + ribbon(k)[5]) / 2;
  const i = Math.floor(lintel.count / 2), sag = lintel.render.sag;
  assert.ok(Math.abs(mid(post.count + i) - (pos[3 * (lintel.start + i) + 1] - sag)) < 0.02, 'drawn a sag below');
  assert.equal(g.nbeam, 4 * 72);
  for (let v = 0; v < g.nbeam; v += 12) assert.ok(g.beam[8 * v + 1] >= pos[3 * 144 + 1] - 0.5, 'beams rise');
});

test('earClip triangulates a concave loop in any plane; cluster puts every pixel in one of k lights', () => {
  const L = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]].map(([a, b]) => [1, a, b]);   // an L in x = 1
  const tris = earClip(L);
  let area = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]].map((j) => L[j]);
    area += Math.abs((b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1])) / 2;
  }
  assert.equal(tris.length, 12);
  assert.equal(area, 3);
  const { pos } = build(FOLLY), c = cluster(pos, FOLLY.count, 6);
  assert.ok(c.n >= 1 && c.n <= 6);
  assert.ok(c.of.every((x) => x >= 0 && x < c.n));
  const ground = playa(0, 0);
  assert.ok(ground.index.every((x) => x < ground.pos.length / 2));
});

test('Auto steps down when the median of 24 drawn frames is over 30 ms, and only then', () => {
  const samples = [], feed = (list) => list.reduce((_, ms) => tooSlow(samples, ms), false);   // the last verdict
  assert.equal(feed(Array(23).fill(80)), false, 'not before 24 frames');
  assert.equal(tooSlow(samples, 80), true, 'the 24th slow frame');
  assert.equal(samples.length, 0, 'a fresh window after each verdict');
  assert.equal(feed([...Array(12).fill(10), ...Array(12).fill(80)]), true, 'median 80');
  assert.equal(feed([...Array(13).fill(10), ...Array(11).fill(80)]), false, 'median 10: fast enough');
  assert.equal(feed(Array(24).fill(400)), false, 'pauses are not samples');
  assert.equal(samples.length, 0);
});
