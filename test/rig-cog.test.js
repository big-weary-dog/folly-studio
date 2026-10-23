// City of Gods (rig.json, the default) lands where its xLights show does: each model's first pixel on the
// StartChannel of city-of-gods/xlights-show/xlights_rgbeffects.xml in the lighting repo, each pixel three channels
// on from the last along its model, so a bake's frames and its .fseq address the real wiring.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { prepareScene, toChannels } from '../public/js/pattern-core.ts';
import { cog } from './fixtures/rigs.js';

// xLights model → [our fixtures in its order, its absolute StartChannel (1-based)]
const XLIGHTS = {
  'Arch Main 1': [['main-arch-1'], 19381], 'Arch Main 2': [['main-arch-2'], 20401],
  'Arch Main 3': [['main-arch-3'], 21421], 'Arch Main 4': [['main-arch-4'], 22441],
  'Arch Main 5': [['main-arch-5'], 23461],
  'Arch Mini Left 1': [['mini-arch-left-1'], 3061], 'Arch Mini Right 1': [['mini-arch-right-1'], 5611],
  'Arch Quad back-top-left front': [['quad-back-top-left-front'], 34039],
  'Arch Quad back-top-left left': [['quad-back-top-left-left'], 34171],
  'Arch Quad back-top-left right': [['quad-back-top-left-right'], 34303],
  'Arch Quad back-top-right front': [['quad-back-top-right-front'], 37609],
  'Arch Quad back-top-right left': [['quad-back-top-right-left'], 37741],
  'Arch Quad back-top-right right': [['quad-back-top-right-right'], 37873],
  'Spire-Back-Left-A': [[1, 2, 3, 4].map((k) => `spire-back-left-${k}`), 31111],
  'Spire-Back-Left-B': [[5, 6, 7, 8].map((k) => `spire-back-left-${k}`), 32641],
  'Spire-Back-Right-A': [[1, 2, 3, 4].map((k) => `spire-back-right-${k}`), 34681],
  'Spire-Back-Right-B': [[5, 6, 7, 8].map((k) => `spire-back-right-${k}`), 36211],
  'Spirelet-Back-Left-1': [['spirelets-back-left', 'spirelet-back-left-5'], 33151],
  'Spirelet-Back-Right-1': [['spirelets-back-right', 'spirelet-back-right-5'], 36721],
  'Rose Window A': [[1, 2, 3, 4, 5, 6, 7, 8].map((k) => `rose-petal-0${k}`), 1],
  'Rose Window B': [['09', 10, 11, 12, 13, 14, 15, 16].map((k) => `rose-petal-${k}`), 511],
};

const scene = prepareScene(cog);
const absolute = (k) => (cog.pixels.universe[k] - 1) * cog.output.channelsPerUniverse + cog.pixels.channel[k];

test('every pixel is on its xLights model\'s channels, and a frame puts its colour there', () => {
  const seen = new Set();
  const frame = new Uint8Array(scene.frameChannels), rgb = new Float32Array(3 * cog.count);
  for (const [model, [ids, start]] of Object.entries(XLIGHTS)) {
    const pixels = ids.flatMap((id) => {
      const f = cog.fixtures.find((x) => x.id === id);
      assert.ok(f, `${model}: ${id}`);
      return Array.from({ length: f.count }, (_, i) => f.start + i);
    });
    pixels.forEach((k, i) => {
      assert.equal(absolute(k), start + 3 * i, `${model} pixel ${i}`);
      seen.add(k);
    });
    rgb.fill(0);
    rgb[3 * pixels[0]] = 1;
    toChannels(scene, rgb, frame);
    assert.equal(frame[start - 1], 255, `${model}: red on channel ${start}`);
  }
  assert.equal(seen.size, cog.count, 'every LED is on a model');
});
