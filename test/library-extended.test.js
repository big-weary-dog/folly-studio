// What the extended modules gained, where a slip is easy and shows: bars' bands as true swatches with no seam round
// the circle, rotate's planes, the layer's middle, life's colour by age, heartbeat's tempo and shape.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import { compileLayer, DEFAULT_PALETTE, prepareLayer, prepareScene, renderFrame } from '../public/js/pattern-core.ts';
import { folly } from './fixtures/rigs.js';

const here = (p) => new URL(p, import.meta.url);
const lib = (name) => readFileSync(here(`../public/patterns/${name}.js`), 'utf8');
const scene = prepareScene(folly);
const mod = (name, kind, params = {}, extra = {}) => ({ id: name, kind, code: lib(name), params, ...extra });
function run(mods, t = 1.25, groups) {
  const layer = { id: 'l', groups, modules: mods }, L = prepareLayer(scene, layer, compileLayer(layer));
  assert.deepEqual(renderFrame(scene, [L], t).errors, []);
  return { L, rgb: (j) => Array.from(L.buf.subarray(4 * j, 4 * j + 3)) };
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

  test('orbit turns round the upright axis in metres, and twist winds it with height', () => {
    const { L, rgb } = run([mod('bars', 'source', { direction: 'orbit-counterclockwise', bars: 3, twist: 1.5, speed: 0,
      softness: 0 })], 0);
    const [ox, , oz] = L.frame, f = (k, j) => ((Math.atan2(scene.Z[k] - oz, ox - scene.X[k]) / (2 * Math.PI) + 1) % 1
      + L.ly[j] * 1.5) * 3;
    const off = Array.from(L.idx, (k, j) => [k, j]).filter(([k, j]) => Math.abs(f(k, j) - Math.round(f(k, j))) > 1e-6);
    assert.ok(off.length > L.idx.length / 2);
    for (const [k, j] of off) assert.equal(hexOf(rgb(j)), ALL[Math.floor(f(k, j)) % ALL.length], `LED ${k}`);
  });

  test('clockwise wraps whole: no partial bar at the seam', () => {
    const { L, rgb } = run([mod('bars', 'source', { direction: 'clockwise', bars: 2.6, speed: 0, softness: 0 })], 0);
    const seam = L.idx.map((_, j) => j).filter((j) => L.a[j] > 0.98 || L.a[j] < 0.02);
    assert.ok(seam.length && seam.every((j) => hexOf(rgb(j)) === ALL[L.a[j] > 0.5 ? 2 : 0]),
      'three whole bars round: no fourth at the seam');
  });

  test('each way is its partner at the opposite speed; round and orbit, saved before, play as they did', () => {
    const buf = (params, t = 0.7) => Array.from(run([mod('bars', 'source', { colours: '#ff0000', profile: 'pulse',
      bars: 3, twist: 0.5, ...params })], t).L.buf);
    const same = (x, y, what) => assert.ok(x.every((v, i) => Math.abs(v - y[i]) < 1e-9), what);
    for (const [a, b] of [['out', 'in'], ['counterclockwise', 'clockwise'], ['orbit-clockwise',
      'orbit-counterclockwise']]) same(buf({ direction: a, speed: 0.4 }), buf({ direction: b, speed: -0.4 }), a);
    assert.deepEqual(buf({ direction: 'round' }), buf({ direction: 'clockwise' }));
    assert.deepEqual(buf({ direction: 'orbit' }), buf({ direction: 'orbit-counterclockwise' }));
  });
});

test('rotate turns in its plane, in metres: a quarter turn in plan swaps depth and across', () => {
  // The probe reads the turned point in metres from the frame's middle, over 40 m so it stays in 0..1.
  const probe = { id: 'p', kind: 'source',
    code: 'function pixel(q) { return [0.5 + (q.X - q.ox) / 40, 0.5 + (q.Z - q.oz) / 40, q.ly]; }' };
  const { L, rgb } = run([probe, mod('rotate', 'warp', { plane: 'plan', angle: 0.25 })]);
  const [ox, , oz] = L.frame;
  L.idx.forEach((k, j) => {
    const [x, z, y] = rgb(j);
    assert.ok(Math.abs(x - (0.5 - (scene.Z[k] - oz) / 40)) < 1e-9 && Math.abs(z - (0.5 + (scene.X[k] - ox) / 40)) < 1e-9
      && Math.abs(y - L.ly[j]) < 1e-9, `LED ${k}`);
  });
});

test('a layer\'s centre (p.cy, p.cz) is the middle of its LEDs (their mean), not its bounds\' middle', () => {
  const disc = 'function pixel(p) { return hypot(p.Y - p.cy, p.Z - p.cz) < 0.3 * p.sr ? [1, 1, 1, 1] : null; }';
  const { L, rgb } = run([{ id: 'disc', kind: 'source', code: disc, params: {} }]);
  let Y = 0, Z = 0;
  L.idx.forEach((k) => { Y += scene.Y[k]; Z += scene.Z[k]; });
  Y /= L.idx.length; Z /= L.idx.length;
  const d = (k) => Math.hypot(scene.Y[k] - Y, scene.Z[k] - Z);
  const lit = Array.from(L.idx, (k, j) => [d(k), Math.max(...rgb(j))]).sort((a, b) => a[0] - b[0]);
  assert.ok(lit[0][1] > 0 && lit.at(-1)[1] === 0, 'lit at the LEDs\' mean, dark at the farthest');
});

test('life colours by age: at the first generation every cell is newborn, so one colour; along a strand, many', () => {
  const lit = (by) => {
    const { L, rgb } = run([mod('life', 'source', { by, smoothing: 0 })], 0);
    return new Set(Array.from(L.idx, (_, j) => j).filter((j) => L.buf[4 * j + 3] > 0.5).map((j) => hexOf(rgb(j))));
  };
  assert.equal(lit('age').size, 1);
  assert.ok(lit('along').size > 3 && lit('cell').size > 3);
});

test('life binary lights every LED in one of two colours: dead the pick\'s first, alive its last', () => {
  const { L, rgb } = run([mod('life', 'source', { by: 'binary', smoothing: 0 })], 0);
  const seen = new Set(Array.from(L.idx, (_, j) => (L.buf[4 * j + 3] === 1 ? hexOf(rgb(j)) : 'unlit')));
  assert.deepEqual([...seen].sort(), [ALL[0], ALL.at(-1)].sort());
});

describe('heartbeat', () => {
  // How much of the beat shows at time t (spread 0: every LED at once); the look's tempo is 120 bpm.
  const at = (params, t) => run([mod('heartbeat', 'source', { spread: 0, ...params })], t).L.buf[3];
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≉ ${b}`);

  test("defaults: lub-dub every two beats of the look's tempo", () => {
    near(at({}, 0), 1); near(at({}, 0.24), 0.7); near(at({}, 0.5), 0); near(at({}, 1), 1);
  });

  test('its own tempo, every, shape and sharpness', () => {
    const own = { tempo: 'own', rate: 60, every: 'four' };
    near(at(own, 0), 1); near(at(own, 0.96), 0.7); near(at(own, 2), 0); near(at(own, 4), 1);
    near(at({ tempo: 'own', rate: 30, every: 'half' }, 1), 1);
    near(at({ every: 'one' }, 0.5), 1);
    near(at({ shape: 'single' }, 0.24), 0); near(at({ second: 0.4 }, 0.24), 0.4);
    assert.ok(at({}, 0.05) > 0.5); near(at({ sharpness: 0.9 }, 0.05), 0);
  });
});
