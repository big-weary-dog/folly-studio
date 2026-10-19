// What the extended modules gained, where a slip is easy and shows: bars' bands as true swatches with no seam round
// the circle, single strand's comets and laps, rotate's planes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import { compileLayer, DEFAULT_PALETTE, prepareLayer, prepareScene, renderFrame } from '../public/js/pattern-core.ts';
import { folly } from './fixtures/rigs.js';

const here = (p) => new URL(p, import.meta.url);
const lib = (name) => readFileSync(here(`../public/patterns/${name}.js`), 'utf8');
const scene = prepareScene(folly);
const mod = (name, kind, params = {}, extra = {}) => ({ id: name, kind, code: lib(name), params, ...extra });
function run(mods, t = 1.25, groups = []) {
  const layer = { id: 'l', groups, modules: mods }, L = prepareLayer(scene, layer, compileLayer(layer));
  assert.deepEqual(renderFrame(scene, [L], t).errors, []);
  return { L, rgb: (j) => Array.from(L.buf.subarray(4 * j, 4 * j + 3)), alpha: (j) => L.buf[4 * j + 3] };
}
const hexOf = (c) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
const ALL = ['low', 'body', 'accent', 'high'].flatMap((r) => DEFAULT_PALETTE[r]);

describe('bars', () => {
  test('bands are true swatches of the pick, in order, across the direction', () => {
    const { L, rgb } = run([mod('bars', 'source', { softness: 0, speed: 0 })], 0);
    L.idx.forEach((k, j) => assert.ok(ALL.includes(hexOf(rgb(j))), `LED ${k}: ${hexOf(rgb(j))}`));
    const across = run([mod('bars', 'source', { softness: 0, speed: 0, bars: 2, direction: 'right' })], 0);
    across.L.idx.forEach((k, j) => assert.equal(hexOf(across.rgb(j)), ALL[Math.floor(across.L.lz[j] * 2)], `LED ${k}`));
  });

  test('round wraps whole: no partial bar at the seam', () => {
    const { L, rgb } = run([mod('bars', 'source', { direction: 'round', bars: 2.6, speed: 0, softness: 0 })], 0);
    const seam = L.idx.map((_, j) => j).filter((j) => L.a[j] > 0.98 || L.a[j] < 0.02);
    assert.ok(seam.length && seam.every((j) => hexOf(rgb(j)) === ALL[L.a[j] > 0.5 ? 2 : 0]),
      'three whole bars round: no fourth at the seam');
  });
});

describe('single strand', () => {
  test('a comet\'s head is the last colour, its tail fading behind; laps leave strands clear', () => {
    const params = { profile: 'comet', colours: '#0000ff #ff0000', size: 30, tail: 6, speed: 40, lap: 120 };
    const { L, rgb, alpha } = run([mod('single-strand', 'source', params)], 2, ['arches']);
    let heads = 0, clear = 0;
    L.idx.forEach((k, j) => {
      if (alpha(j) > 0.9) { heads++; assert.ok(rgb(j)[0] > 0.85 && rgb(j)[2] < 0.15, `LED ${k}: a red head`); }
      if (alpha(j) === 0) clear++;
    });
    assert.ok(heads > 10 && clear > L.idx.length / 3, `heads ${heads}, clear ${clear}`);
  });
});

test('rotate turns in its plane: a quarter turn in plan swaps depth and across', () => {
  const probe = { id: 'p', kind: 'source', code: 'function pixel(q) { return [q.lx, q.lz, q.ly]; }' };
  const { L, rgb } = run([probe, mod('rotate', 'warp', { plane: 'plan', angle: 0.25 })]);
  L.idx.forEach((k, j) => {
    const [x, z, y] = rgb(j);
    assert.ok(Math.abs(x - (1 - L.lz[j])) < 1e-9 && Math.abs(z - L.lx[j]) < 1e-9 && y === L.ly[j], `LED ${k}`);
  });
});
