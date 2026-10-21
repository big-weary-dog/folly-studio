// The rose warps (SPEC-library "Library"): ring-turn, petal-repeat and petal-stride move whole petals of the rose,
// found by its tag, keeping each LED's ring; off the rose they leave every LED as it was. On both rigs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import { compileLayer, prepareLayer, prepareScene, renderFrame, tagMask } from '../public/js/pattern-core.ts';
import { cog, folly } from './fixtures/rigs.js';

const lib = (name) => readFileSync(new URL(`../public/patterns/${name}.js`, import.meta.url), 'utf8');
const mod = (name, kind, params = {}) => ({ id: name, kind, code: lib(name), params });
// Each LED's sector, ring and index as its colour, so the output names the LED a warp read.
const PROBE = { id: 'probe', kind: 'source',
  code: 'function pixel(p) { return [(p.sector + 1) / 17, p.ring / 8, (p.k + 1) / 10000]; }' };
const wrap = (v) => ((v % 16) + 16) % 16;
const block = (repeats) => 16 / { two: 2, four: 4, eight: 8, sixteen: 16 }[repeats];

// Each warp's settings, with the petal each rose LED (petal p, ring n) should read.
const CASES = [
  ['ring-turn', {}, (p, n) => wrap(p - (n - 1))],
  ['ring-turn', { step: -3 }, (p, n) => wrap(p + 3 * (n - 1))],
  ['ring-turn', { step: 2, alternate: true }, (p, n) => wrap(p - ((n - 1) % 2 ? -1 : 1) * 2 * (n - 1))],
  ['ring-turn', { step: 0, speed: 1 }, (p, n) => wrap(p - 2 * (n - 1)), 2.5],
  ['petal-repeat', {}, (p) => (p % 4 + (Math.floor(p / 4) % 2 ? 3 - 2 * (p % 4) : 0)) % 16],
  ...['two', 'four', 'eight', 'sixteen'].flatMap((repeats) => [true, false].map((mirror) => {
    const n = block(repeats), flip = (p) => mirror && Math.floor(p / n) % 2;
    return ['petal-repeat', { repeats, petal: 3, mirror }, (p) => (3 + (flip(p) ? n - 1 - p % n : p % n)) % 16];
  })),
  ...[1, 3, 5, 7, 9, 11, 13, 15].map((stride) => ['petal-stride', { stride, offset: 2 }, (p) => (p * stride + 2) % 16]),
  ['petal-stride', { stride: 4 }, (p) => (p * 5) % 16],      // typed even: the next odd
];

for (const [rigName, rig] of Object.entries({ cog, folly })) {
  const scene = prepareScene(rig), mask = tagMask(scene, 'rose');
  const rose = [...mask.keys()].filter((k) => mask[k]);
  const render = (modules, t = 1) => {
    const layer = { id: 'l', modules };
    const { rgb, errors } = renderFrame(scene, [prepareLayer(scene, layer, compileLayer(layer))], t);
    assert.deepEqual(errors, []);
    return rgb.slice();
  };
  const read = (rgb, k) => ({ sector: Math.round(rgb[3 * k] * 17) - 1, ring: Math.round(rgb[3 * k + 1] * 8),
    k: Math.round(rgb[3 * k + 2] * 10000) - 1 });

  describe(`on ${rigName}`, () => {
    test('the rose is sixteen petals of seven rings', () => {
      assert.ok(rose.length >= 112, `${rose.length} rose LEDs`);
      assert.deepEqual(new Set(rose.map((k) => scene.sector[k])).size, 16);
      assert.deepEqual(new Set(rose.map((k) => scene.ring[k])).size, 7);
    });

    for (const [name, params, want, t = 1] of CASES) {
      test(`${name} ${JSON.stringify(params)}: each rose LED reads its petal, ring kept; off it nothing moves`, () => {
        const rgb = render([PROBE, mod(name, 'warp', params)], t), seen = new Set();
        for (let k = 0; k < scene.count; k++) {
          const got = read(rgb, k);
          if (!mask[k]) {
            assert.deepEqual(got, { sector: scene.sector[k], ring: scene.ring[k], k }, `off the rose: LED ${k}`);
            continue;
          }
          seen.add(got.k);
          assert.equal(got.ring, scene.ring[k], `LED ${k}: ring`);
          assert.equal(got.sector, want(scene.sector[k], scene.ring[k]), `LED ${k} (petal ${scene.sector[k]}): petal`);
          assert.equal(scene.sector[got.k], got.sector, `LED ${k}: reads a real LED`);
        }
        // A permutation reads every rose LED once; a repeat reads only its block.
        const n = name === 'petal-repeat' ? block(params.repeats ?? 'four') : 16;
        assert.equal(seen.size, rose.length * n / 16, 'distinct LEDs read');
      });
    }

    test('Mirror reflects the cells in a copied petal; a source off the rose is exactly as it was', () => {
      const one = (mirror) => render([PROBE, mod('petal-repeat', 'warp', { repeats: 'sixteen', mirror })]);
      const [on, off] = [one(true), one(false)];
      const odd = rose.filter((k) => scene.sector[k] % 2);
      assert.ok(odd.some((k) => read(on, k).k !== read(off, k).k), 'a mirrored petal reads its cells reflected');
      assert.ok(rose.filter((k) => scene.sector[k] % 2 === 0).every((k) => read(on, k).k === read(off, k).k));
      const bars = mod('bars', 'source', { direction: 'right', bars: 5, profile: 'smooth', speed: 0.4 });
      const plain = render([bars], 2);
      for (const [name, params] of CASES) {
        const rgb = render([bars, mod(name, 'warp', params)], 2), map = render([PROBE, mod(name, 'warp', params)], 2);
        for (let k = 0; k < scene.count; k++) {
          const from = mask[k] ? read(map, k).k : k;
          for (let c = 0; c < 3; c++) assert.equal(rgb[3 * k + c], plain[3 * from + c], `${name}: LED ${k}`);
        }
      }
    });
  });
}
