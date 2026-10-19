// The library's new primitives where a slip is easy: polar and anchor's geometry on the Folly and the fictional mini
// rig, and the colour wash's hold, which keeps a change of colour from flashing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import { compileLayer, prepareLayer, prepareScene, renderFrame, tagCentres } from '../public/js/pattern-core.ts';
import { folly, mini } from './fixtures/rigs.js';

const lib = (name) => readFileSync(new URL(`../public/patterns/${name}.js`, import.meta.url), 'utf8');
// A probe source that says what it reads: three of the pixel's fields as its colour.
const probe = (a, b, c) => ({ id: 'p', kind: 'source',
  code: `function pixel(q) { return [q.${a}, q.${b}, q.${c}]; }` });
const mod = (name, kind, params = {}, extra = {}) => ({ id: name, kind, code: lib(name), params, ...extra });
/** The chain on `groups` of `scene` at t: each of its LEDs' colour, and the layer. */
function run(scene, modules, groups, t = 1.25) {
  const layer = { id: 'l', groups, modules };
  const L = prepareLayer(scene, layer, compileLayer(layer));
  const { rgb, errors } = renderFrame(scene, [L], t);
  assert.deepEqual(errors, []);
  return { L, at: (k) => [rgb[3 * k], rgb[3 * k + 1], rgb[3 * k + 2]], alpha: (j) => L.buf[4 * j + 3] };
}
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} ≉ ${b}`);

for (const [rigName, rig] of Object.entries({ folly, mini })) {
  const scene = prepareScene(rig);
  describe(`on the ${rigName} rig`, () => {
    test('polar: across reads the angle, up the radius (inward: one less it), repeated round', () => {
      const plain = run(scene, [probe('lz', 'ly', 'r'), mod('polar', 'warp')], []);
      const twice = run(scene, [probe('lz', 'ly', 'r'), mod('polar', 'warp', { repeats: 2, inward: true })], []);
      plain.L.idx.forEach((k, j) => {
        const a = plain.L.a[j], r = plain.L.r[j];
        near(plain.at(k)[0], a, 1e-6, `LED ${k} across`);
        near(plain.at(k)[1], r, 1e-6, `LED ${k} up`);
        near(twice.at(k)[0], (2 * a) % 1, 1e-5, `LED ${k} across, twice round`);
        near(twice.at(k)[1], 1 - r, 1e-6, `LED ${k} up, inward`);
      });
    });

    const [rose] = tagCentres(scene, 'rose');
    test('anchor: the façade round the rose, centred and reaching the layer\'s farthest corner', () => {
      const { L, at } = run(scene, [probe('lz', 'ly', 'r'), mod('anchor', 'warp')], []);
      const dist = (k) => Math.hypot(scene.Z[k] - rose[2], scene.Y[k] - rose[1]);
      const reach = Math.max(...[0, 1].flatMap((i) => [0, 1].map((j) => Math.hypot(
        L.bounds[i ? 'max' : 'min'][2] - rose[2], L.bounds[j ? 'max' : 'min'][1] - rose[1]))));
      for (const k of L.idx) {
        near(at(k)[2], dist(k) / reach, 1e-5, `LED ${k} r`);
        near(at(k)[0], 0.5 + (scene.Z[k] - rose[2]) / (2 * reach), 1e-5, `LED ${k} lz`);
        near(at(k)[1], 0.5 + (scene.Y[k] - rose[1]) / (2 * reach), 1e-5, `LED ${k} ly`);
      }
    });

    test('anchor: a sphere in metres, and lined up on the whole rig', () => {
      const reach = 6;
      const { L, at } = run(scene, [probe('x', 'lz', 'r'), mod('anchor', 'warp', { shape: 'sphere', reach,
        lineup: true })], []);
      for (const k of L.idx) {
        const d = Math.hypot(scene.X[k] - rose[0], scene.Y[k] - rose[1], scene.Z[k] - rose[2]) / reach;
        if (d <= 1) near(at(k)[2], d, 1e-5, `LED ${k} r`);
        near(at(k)[1], scene.z[k], 1e-6, `LED ${k} lz is the rig's z`);
      }
    });
  });
}

describe('on the Folly', () => {
  const scene = prepareScene(folly), towers = tagCentres(scene, 'tower');
  test('colour wash: the whole layer one colour, held, then blended into the next, never faster than a fifth', () => {
    const wash = (params, t) => run(scene, [mod('colour-wash', 'source', { colours: '#ff0000 #0000ff', ...params })],
      [], t);
    const one = (params, t) => {
      const { L, at, alpha } = wash(params, t), c = at(L.idx[0]);
      L.idx.forEach((k, j) => assert.ok(near3(at(k), c) && alpha(j) === 1, `t = ${t}: one opaque colour`));
      return c;
    };
    const near3 = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
    for (const t of [0, 0.2, 0.49]) assert.ok(near3(one({ speed: 1 }, t), [1, 0, 0]), `held red at ${t}`);
    assert.ok(near3(one({ speed: 1 }, 0.75), [0.5, 0, 0.5]), 'half way at 0.75 s');
    for (const t of [1, 1.3]) assert.ok(near3(one({ speed: 1 }, t), [0, 0, 1]), `held blue at ${t}`);
    assert.ok(near3(one({ speed: 1, hold: 0.95 }, 0.9), [0.5, 0, 0.5]), 'a hold past 0.8 still blends over a fifth');
  });

  test('anchor: in plan round each LED\'s nearest tower', () => {
    const { L, at } = run(scene, [probe('lx', 'lz', 'r'), mod('anchor', 'warp', { tag: 'tower', which: 'nearest',
      shape: 'plan', reach: 4 })], ['spires']);
    for (const k of L.idx) {
      const d = Math.min(...towers.map((c) => Math.hypot(scene.X[k] - c[0], scene.Z[k] - c[2])));
      assert.ok(d < 4, 'every spire LED is near a tower');
      near(at(k)[2], d / 4, 1e-5, `LED ${k} r`);
    }
  });
});
