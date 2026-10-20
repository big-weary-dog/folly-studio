// Reorder (SPEC-library "The neighbour map"): wireDistance() along the wiring, rowOrder()'s rows, the warp re-keying
// out on City of Gods; and mask's Scatter, which at 0 is mask as it was.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import { compileLayer, prepareLayer, prepareScene, renderFrame } from '../public/js/pattern-core.ts';
import { tagMask, tagParts } from '../public/js/core/scene.ts';
import { at, COG, layerOf } from './fixtures/layers.js';

/** A rig of fixtures [id, tags, points] (y up, z right), a group each under `all`. */
function rigOf(fixtures) {
  const pos = fixtures.flatMap(([, , pts]) => pts.flat()), count = pos.length / 3;
  let start = 0;
  return { rig: 1, count, output: { universes: 1, channelsPerUniverse: 510 },
    bounds: { min: [-5, -5, -5], max: [5, 5, 5] }, axes: { front: '-x', up: '+y', right: '+z' },
    fixtures: fixtures.map(([id, , pts]) => ({ id, start: (start += pts.length) - pts.length, count: pts.length })),
    pixels: { universe: Array(count).fill(1), channel: Array.from({ length: count }, (_, k) => 1 + 3 * k), pos },
    groups: [{ id: 'all', parent: null, tags: ['all'] },
      ...fixtures.map(([id, tags]) => ({ id: `g-${id}`, parent: 'all', fixtures: [id], tags }))] };
}
const line = (n, at) => Array.from({ length: n }, (_, i) => at(i));

/** What `expr` (of p, by k) is at every LED of a whole-rig layer on S, read back as red. */
function probe(S, expr) {
  const code = `function pixel(p) { return [${expr}, 0, 0]; }`;
  const layer = { id: 'l', modules: [{ id: 'm', kind: 'source', code }] };
  const L = prepareLayer(S, layer, compileLayer(layer));
  assert.deepEqual(renderFrame(S, [L], 0).errors, []);
  return Array.from(L.idx, (_, j) => L.buf[4 * j]);
}

describe('wireDistance', () => {
  // A start LED; a strand rising from just above it; a hook up, across and back down beside it; a far piece.
  const hook = [...line(8, (i) => [0, 0.3 + 0.1 * i, -0.6]), ...line(6, (i) => [0, 1, -0.5 + 0.1 * i]),
    ...line(8, (i) => [0, 0.9 - 0.1 * i, 0.6])];
  const S = prepareScene(rigOf([['src', ['start'], [[0, 0, 0]]], ['a', [], line(10, (i) => [0, 0.3 + 0.1 * i, 0])],
    ['hook', [], hook], ['far', [], [[0, 0, 3], [0, 0, 3.1]]]]));
  const d = probe(S, 'wireDistance("start")[p.k] / 10').map((v) => v * 10);

  test('metres along the wiring from every LED of the tag', () => {
    assert.equal(d[0], 0);
    for (let i = 0; i < 10; i++) assert.ok(Math.abs(d[1 + i] - (0.3 + 0.1 * i)) < 1e-6, `a ${i}: ${d[1 + i]}`);
  });

  test('round the hook, not through the air', () => {
    const end = d[11 + hook.length - 1], straight = Math.hypot(0.2, 0.6);
    assert.ok(end > 2 * straight, `the hook's far end ${end} m along the wire, ${straight} m away`);
  });

  test('a piece the wiring never reaches: straight-line plus the lag, then along its own wire', () => {
    const f = 11 + hook.length;
    assert.ok(Math.abs(d[f] - 5) < 1e-6 && Math.abs(d[f + 1] - 5.1) < 1e-6, `${d[f]} ${d[f + 1]}`);
  });

  test('top: each network starts at its highest LEDs', () => {
    const top = probe(S, 'wireDistance("top")[p.k] / 10');
    assert.equal(top[10], 0, 'the strand\'s top');
    assert.equal(top[11 + hook.length], 0, 'the far piece is level: all of it starts');
  });
});

describe('rowOrder', () => {
  const row = (by, seed) => probe(COG, `rowOrder("${by}", ${seed})[p.k]`);

  test('random: one shuffle a seed, the same every time; another seed another', () => {
    const a = row('random', 3);
    assert.deepEqual(row('random', 3), a);
    assert.notDeepEqual(row('random', 4), a);
    const m = a.length - 1, ranks = a.map((v) => Math.round(v * m)).sort((x, y) => x - y);
    assert.deepEqual(ranks, ranks.map((_, i) => i), 'each place once');
  });

  test('strands run in rig order; groups keep each group in one run', () => {
    const s = row('strands', 0);
    assert.ok(s.every((v, k) => k === 0 || v > s[k - 1]));
    const g = row('groups', 0), { of, n } = tagParts(COG, 'all'), lo = Array(n).fill(2), hi = Array(n).fill(-1);
    g.forEach((v, k) => { lo[of[k]] = Math.min(lo[of[k]], v); hi[of[k]] = Math.max(hi[of[k]], v); });
    const runs = lo.map((v, i) => [v, hi[i]]).sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < n; i++) assert.ok(runs[i][0] > runs[i - 1][1], `group runs overlap at ${i}`);
  });
});

describe('the reorder warp', () => {
  const r = (params) => {
    const L = at(layerOf(['probe', {}, 'function pixel(p) { return [p.r, p.a, 0]; }'], ['reorder', params]), 0);
    return Array.from(L.idx, (_, j) => [L.buf[4 * j], L.buf[4 * j + 1]]);
  };

  test('by wires from the rose: its heart at 0, out ring by ring and along the wiring to 1; the angle stays', () => {
    const plain = r({ amount: 0 }), wired = r({}), ring = COG.ring, rose = tagMask(COG, 'rose');
    const d = probe(COG, 'wireDistance("rose")[p.k] / 100').map((v) => v * 100), far = Math.max(...d);
    wired.forEach(([v], k) => assert.ok(Math.abs(v - Math.min(1, d[k] / far)) < 1e-6, `${k}: ${v}`));
    const mean = (n) => {
      const on = d.filter((_, k) => rose[k] && ring[k] === n);
      return on.reduce((a, b) => a + b, 0) / on.length;
    };
    assert.ok(Math.min(...d) === 0 && mean(1) < mean(4) && mean(4) < mean(7), `${mean(1)} ${mean(4)} ${mean(7)}`);
    assert.ok(wired.every(([, a], k) => Math.abs(a - plain[k][1]) < 1e-9), 'the angle');
  });
});

describe('mask scatter', () => {
  const lib = (name) => readFileSync(new URL(`../public/patterns/${name}.js`, import.meta.url), 'utf8');
  const look = (maskCode, params) => {
    const layer = { id: 'l', modules: [{ id: 's', kind: 'source', ref: 'clouds', code: lib('clouds'), params: {} },
      { id: 'm', kind: 'filter', code: maskCode, params: { by: 'self', ...params } }] };
    const L = prepareLayer(COG, layer, compileLayer(layer));
    return Float32Array.from(renderFrame(COG, [L], 1.5).rgb);
  };

  test('0 is mask as it was, byte for byte', () => {
    const before = lib('mask').replace(/const cut = .*\n/, 'const cut = P.cutoff;\n');
    assert.notEqual(before, lib('mask'));
    const bytes = (rgb) => Buffer.from(rgb.buffer);
    assert.ok(bytes(look(lib('mask'), { scatter: 0 })).equals(bytes(look(before, {}))));
  });

  test('0.8 breaks the edge into dots: some lit where the plain mask is dark', () => {
    const plain = look(lib('mask'), {}), dots = look(lib('mask'), { scatter: 0.8 });
    let more = 0;
    for (let i = 0; i < plain.length; i += 3) if (plain[i] + plain[i + 1] + plain[i + 2] === 0 && dots[i] > 0) more++;
    assert.ok(more > 20, `${more} LEDs lit by scatter alone`);
  });
});
