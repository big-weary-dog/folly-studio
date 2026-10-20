// The neighbour map (SPEC-library "The neighbour map"): chains along strands, links where strands touch, rungs to the
// next strand of a zone, pieces far apart left alone; links() as a layer's share of it, inside pattern code.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { compileLayer, linkMap, prepareLayer, prepareScene, renderFrame } from '../public/js/pattern-core.ts';
import { folly } from './fixtures/rigs.js';

/** A rig of fixtures given as [id, zone, points]: y up, z right, one group per fixture under `all`. */
function rigOf(fixtures) {
  const pos = fixtures.flatMap(([, , pts]) => pts.flat()), count = pos.length / 3;
  let start = 0;
  return { rig: 1, count, output: { universes: 1, channelsPerUniverse: 510 },
    bounds: { min: [-5, -5, -5], max: [5, 5, 5] }, axes: { front: '-x', up: '+y', right: '+z' },
    fixtures: fixtures.map(([id, zone, pts]) => ({ id, zone, start: (start += pts.length) - pts.length,
      count: pts.length })),
    pixels: { universe: Array(count).fill(1), channel: Array.from({ length: count }, (_, k) => 1 + 3 * k), pos },
    groups: [{ id: 'all', parent: null },
      ...fixtures.map(([id]) => ({ id: `g-${id}`, parent: 'all', fixtures: [id] }))] };
}
const line = (n, at) => Array.from({ length: n }, (_, i) => at(i));
// Two arches 1 m apart (a zone), a post touching the first's end, two floods 2 m apart.
const rig = rigOf([
  ['a', 'arch', line(30, (i) => [0, i * 0.1, 0])],
  ['b', 'arch', line(30, (i) => [0, i * 0.1, 1])],
  ['post', 'post', line(10, (i) => [0, 3.2 + i * 0.1, 0.2])],
  ['floods', 'flood', [[0, 0, 3], [0, 0, 5]]],
]);
const S = prepareScene(rig);
const pairs = (g) => {
  const out = [];
  for (let k = 0; k < S.count; k++) for (let e = g.off[k]; e < g.off[k + 1]; e++) out.push([k, g.nb[e]]);
  return out;
};

test('strands chain, touch where they come close, rung to the next of their zone; far pieces stay apart', () => {
  const g = linkMap(S), all = pairs(g), has = (a, b) => all.some(([x, y]) => x === a && y === b);
  for (const [a, b] of all) assert.ok(has(b, a), `${a}–${b} both ways`);
  for (let k = 0; k < 29; k++) assert.ok(has(k, k + 1), `a chains ${k}`);
  assert.ok(has(29, 60), 'the post touches the end of a');
  const rungs = all.filter(([x, y]) => x < 30 && y >= 30 && y < 60);
  assert.deepEqual(rungs.map(([x, y]) => y - x), [30, 30, 30], 'a rung every metre, straight across');
  assert.equal(g.off[71] - g.off[70], 0, 'floods 2 m apart are alone');
  assert.ok(!all.some(([x, y]) => x >= 30 && x < 60 && y >= 60), 'b is too far from the post');
});

test('links() is the running layer\'s share, the same object every frame', () => {
  const code = `let first = null, same = 0;
    function frame() { first ??= links(); same = first === links() ? 1 : 0; }
    function pixel(p) { const L = links(); return [(L.off[p.k + 1] - L.off[p.k]) / 4, same, 0]; }`;
  const layer = { id: 'l', groups: ['g-a'], modules: [{ id: 'm', kind: 'source', code }] };
  const L = prepareLayer(S, layer, compileLayer(layer));
  renderFrame(S, [L], 0);
  const rgb = Float32Array.from(renderFrame(S, [L], 0.1).rgb);
  assert.equal(rgb[0], 0.25, 'an end: one neighbour in the layer');
  assert.equal(rgb[3 * 5], 0.5, 'two along the strand; the rung to b is outside the layer');
  assert.equal(rgb[3 * 29], 0.25, 'the post is outside the layer');
  assert.equal(rgb[1], 1, 'the same map in the next frame');
});

test('on the Folly: each main arch neighbours the next; the mini arches stand apart from them', () => {
  const F = prepareScene(folly), g = linkMap(F), zone = (k) => F.fixtures[F.fixture[k]].zone;
  const fix = (k) => F.fixtures[F.fixture[k]].id, across = new Set();
  for (let k = 0; k < F.count; k++) {
    for (let e = g.off[k]; e < g.off[k + 1]; e++) {
      const j = g.nb[e];
      if (F.fixture[j] !== F.fixture[k]) across.add(`${fix(k)} ${fix(j)}`);
      assert.ok(!(zone(k) === 'main-arch' && zone(j).startsWith('mini-arch')), `${fix(k)} – ${fix(j)}`);
    }
  }
  for (let i = 1; i < 5; i++) assert.ok(across.has(`main-arch-${i} main-arch-${i + 1}`), `main arch ${i} to ${i + 1}`);
});
