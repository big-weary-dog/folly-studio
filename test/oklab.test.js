// Colour fades in OKLab (core/oklab.ts): the tabled fade against the reference written out with exact pow, its ends
// exact, and out of gamut clamped to 0..1.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { fadeInto } from '../public/js/core/oklab.ts';
import { rand } from '../public/js/core/stdlib.ts';
import { fade } from './fixtures/oklab.js';

test('a fade is OKLab within 1e-4 of the reference, its ends exact', () => {
  const out = [0, 0, 0];
  for (let i = 0; i < 2000; i++) {
    const a = [rand(i, 1), rand(i, 2), rand(i, 3)], b = [rand(i, 4), rand(i, 5), rand(i, 6)], t = rand(i, 7);
    const want = fade(a, b, t);
    fadeInto(a, b, t, out).forEach((v, c) => assert.ok(Math.abs(v - want[c]) < 1e-4, `${a} → ${b} at ${t}: ${out}`));
    assert.deepEqual(fadeInto(a, b, 0, out), a);
    assert.deepEqual(fadeInto(a, b, 1, out), b);
  }
  assert.deepEqual(fadeInto([0.2, 0.4, 0.6], [0.2, 0.4, 0.6], 0.3, out), [0.2, 0.4, 0.6], 'one colour stays put');
});

test('it keeps its brightness where a fade of values dips: red to green, blue to yellow', () => {
  const light = (c) => 0.2126 * c[0] ** 2.2 + 0.7152 * c[1] ** 2.2 + 0.0722 * c[2] ** 2.2;   // luminance
  for (const [a, b] of [[[1, 0, 0], [0, 1, 0]], [[0, 0, 1], [1, 1, 0]]]) {
    const mid = fadeInto(a, b, 0.5, [0, 0, 0]), byValue = a.map((v, i) => (v + b[i]) / 2);
    assert.ok(light(mid) > 1.5 * light(byValue), `${a} → ${b}: ${light(mid)} vs ${light(byValue)}`);
  }
});

test('out of gamut, each channel is clamped to 0..1 (or an end beyond), and t outside 0..1 runs on', () => {
  const out = [0, 0, 0];
  for (let i = 0; i < 500; i++) {
    const a = [rand(i, 8), 0, rand(i, 9)], b = [0, rand(i, 10), 1];
    fadeInto(a, b, rand(i, 11), out).forEach((v) => assert.ok(v >= 0 && v <= 1, `${out}`));
  }
  const hot = fadeInto([0, 0, 0], [2, 2, 2], 0.9, out);
  assert.ok(hot[0] > 1 && hot[0] <= 2, 'values over 1 (a bright pattern) are kept');
  assert.ok(fadeInto([0, 0, 0], [0.5, 0.5, 0.5], 1.5, out)[0] > 0.5, 'past b');
});
