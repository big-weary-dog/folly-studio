// Filters that hide or fade do it by alpha (SPEC "Drawing on transparent"): mask (by its input or by itself),
// threshold and trails leave what they hide transparent, never black; trails fades whole colours, by the second.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { test } from 'vitest';

import { compileLayer, prepareLayer, prepareScene, renderFrame } from '../public/js/pattern-core.ts';
import { lineRig } from './fixtures/rigs.js';

const lib = (name) => readFileSync(new URL(`../public/patterns/${name}.js`, import.meta.url), 'utf8');
const scene = prepareScene(lineRig(4));
const src = (code) => ({ id: 's', kind: 'source', code: `function pixel(p, t) { ${code} }` });
const filter = (name, params = {}) => ({ id: name, kind: 'filter', code: lib(name), params });
/** The layer's rgba at LED 0 after playing frames at fps up to t. */
function play(modules, t, fps = 40) {
  const layer = { id: 'l', modules }, L = prepareLayer(scene, layer, compileLayer(layer));
  for (let f = 0; f <= Math.round(t * fps); f++) assert.deepEqual(renderFrame(scene, [L], f / fps).errors, []);
  return Array.from(L.buf.subarray(0, 4));
}
const near = (a, b, what) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-4, `${what}: ${a} ≉ ${b}`));

test('mask by self and threshold: below the level transparent, the colour kept', () => {
  const dim = src('return [0.3, 0.2, 0.1];'), bright = src('return [0.9, 0.5, 0.1];');
  near(play([dim, filter('mask', { by: 'self', cutoff: 0.6, softness: 0.1 })], 0), [0.3, 0.2, 0.1, 0], 'mask, dim');
  near(play([bright, filter('mask', { by: 'self', cutoff: 0.6, softness: 0.1 })], 0), [0.9, 0.5, 0.1, 1], 'mask');
  near(play([dim, filter('threshold', { level: 0.6, softness: 0.05 })], 0), [0.3, 0.2, 0.1, 0], 'threshold');
});

test('trails: transparent where nothing was, a fading colour that keeps its hue, the same at 20 and 40 fps', () => {
  const flash = src('return t <= 0.5 ? [1, 0.25, 0] : null;');
  near(play([src('return null;'), filter('trails')], 2), [0, 0, 0, 0], 'nothing drawn');
  for (const fps of [20, 40]) {
    const [r, g, b, a] = play([flash, filter('trails', { decay: 0.5 })], 1.5, fps);
    near([r, g, b, a], [1, 0.25, 0, 0.5], `a second after the light went, at ${fps} fps`);
  }
});
