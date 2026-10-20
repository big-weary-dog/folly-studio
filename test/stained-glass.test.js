// Stained glass (library-docs/stained-glass.md) on City of Gods' rose: its rules colour the panes by petal and ring,
// the leading darkens edge panes where colours meet, and the light is the backlight plus what is above.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { describe, test } from 'vitest';

import { compileLayer, prepareLayer, prepareLook, prepareScene, renderFrame } from '../public/js/pattern-core.ts';
import { STUDIO } from './fixtures/generate/shared.js';

const read = (f) => fs.readFileSync(path.join(STUDIO, f), 'utf8');
const RIG = JSON.parse(read('public/data/rig.json')), CODE = read('public/patterns/stained-glass.js');
const scene = prepareScene(RIG), { ring, sector } = RIG.pixels.attrs;
const ROSE = [...Array(scene.count).keys()].filter((k) => ring[k] > 0);
const RGB = ['#ff0000', '#00ff00', '#0000ff'], WHITE = 'const params = {}; function pixel() { return [1, 1, 1]; }';

/** Each rose pane's [r, g, b] (0–255) at t with the filter's params, over a white source when `lit`. */
function glass(params, { t = 0, lit = false } = {}) {
  const modules = [...lit ? [{ id: 's', kind: 'source', code: WHITE, params: {} }] : [],
    { id: 'g', kind: 'filter', code: CODE, params: { colours: RGB.join(' '), leading: 0, ...params } }];
  const layer = { id: 'l', groups: ['rose-window'], modules };
  const out = renderFrame(scene, [prepareLayer(scene, layer, compileLayer(layer))], t, null, prepareLook({}));
  assert.deepEqual(out.errors, []);
  return (k) => [0, 1, 2].map((c) => Math.round(out.rgb[k * 3 + c] * 255));
}
const hue = (c) => c.indexOf(Math.max(...c));
const groupsBy = (at, key) => {
  const m = new Map();
  for (const k of ROSE) m.set(key(k), new Set([...m.get(key(k)) ?? [], hue(at(k))]));
  return m;
};

describe('stained glass on the rose', () => {
  test('petal: one colour a petal, in turn; ring: one a ring; alternate and rings: two', () => {
    const petal = groupsBy(glass({ rule: 'petal', backlight: 1 }), (k) => sector[k]);
    assert.equal(petal.size, 16);
    for (const [s, hues] of petal) assert.deepEqual([...hues], [s % 3], `petal ${s}`);
    const rings = groupsBy(glass({ rule: 'ring', backlight: 1 }), (k) => ring[k]);
    for (const [j, hues] of rings) assert.deepEqual([...hues], [(j - 1) % 3], `ring ${j}`);
    const alt = glass({ rule: 'alternate', backlight: 1 });
    assert.deepEqual(new Set(ROSE.map((k) => hue(alt(k)))), new Set([0, 1]));
  });

  test('every rule is the same each time it plays, and random follows its seed', () => {
    for (const rule of ['spiral', 'wedges', 'checker', 'centre', 'gradient', 'random', 'rings']) {
      const a = glass({ rule }), b = glass({ rule });
      assert.deepEqual(ROSE.map(a), ROSE.map(b), rule);
    }
    assert.notDeepEqual(ROSE.map(glass({ rule: 'random', seed: 1 })), ROSE.map(glass({ rule: 'random', seed: 2 })));
  });

  test('the light: backlight alone, plus a source above, nothing at 0; leading darkens edges', () => {
    const k = ROSE.find((i) => ring[i] === 1 && sector[i] === 0);
    assert.deepEqual(glass({ rule: 'petal', backlight: 0.5 })(k), [128, 0, 0]);
    assert.deepEqual(glass({ rule: 'petal', backlight: 0.5 }, { lit: true })(k), [255, 0, 0]);
    assert.deepEqual(glass({ rule: 'petal', backlight: 0 })(k), [0, 0, 0]);
    const edge = ROSE.find((i) => ring[i] === 5 && sector[i] === 0), mid = ROSE.filter((i) => ring[i] === 5
      && sector[i] === 0)[1];
    const lead = glass({ rule: 'petal', backlight: 1, leading: 0.5 });
    assert.deepEqual([lead(edge), lead(mid)], [[128, 0, 0], [255, 0, 0]]);
  });

  test('amount 0 leaves what is above; glow and sweep move the light gently', () => {
    const k = ROSE[40];
    assert.deepEqual(glass({ amount: 0 }, { lit: true })(k), [255, 255, 255]);
    for (const motion of ['glow', 'sweep']) {
      const a = glass({ rule: 'petal', backlight: 0.8, motion, speed: 0.2 }, { t: 0 });
      const b = glass({ rule: 'petal', backlight: 0.8, motion, speed: 0.2 }, { t: 1.5 });
      assert.ok(ROSE.some((i) => a(i).join() !== b(i).join()), `${motion} moves`);
    }
  });
});
