// Colour fades in OKLab (core/oklab.ts): the tabled fade against the reference written out with exact pow, its ends
// exact, and out of gamut clamped to 0..1; a fixed ramp's table (stdlib ramp) against its fades.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { toLight } from '../public/js/core/light.ts';
import { fadeInto } from '../public/js/core/oklab.ts';
import { rand, ramp } from '../public/js/core/stdlib.ts';
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

test('a frozen ramp reads its table: its light within 0.05/255 of its fades, its colours exact; others fade', () => {
  const fades = (L, t) => {
    if (L.length === 1 || !(t > 0)) return L[0];
    const f = Math.min(t, 1) * (L.length - 1), i = Math.min(L.length - 2, Math.floor(f));
    return fadeInto(L[i], L[i + 1], f - i, [0, 0, 0]);
  };
  for (let r = 0; r < 40; r++) {
    const stops = Array.from({ length: 1 + (r % 6) }, (_, k) => [0, 1, 2].map((c) => rand(r, 3 * k + c)));
    stops[0][r % 3] = 0;                                    // a channel from 0, where the value curve is steepest
    const fixed = Object.freeze(stops.map((c) => Object.freeze(c)));
    for (let k = 0; k <= 4000; k++) {                      // in light, as the LEDs show it: near black a value is steep
      const t = k / 4000 + (k % 7 === 0 ? 1e-6 : 0), want = fades(fixed, t);
      ramp(fixed, t).forEach((v, c) => assert.ok(Math.abs(toLight(v) - toLight(want[c])) < 0.05 / 255,
        `${r} at ${t}: ${v} vs ${want}`));
    }
    fixed.forEach((c, k) => assert.deepEqual(ramp(fixed, k / (fixed.length - 1 || 1)), c));
    assert.deepEqual(ramp(fixed, 0), fixed[0]);
    assert.deepEqual(ramp(fixed, -1), fixed[0]);
    const loose = stops.map((c) => [...c]);                  // not frozen: may change, so never tabled
    assert.deepEqual(ramp(loose, 0.37), [...fades(loose, 0.37)]);
    loose[loose.length - 1][0] = 0.5;
    assert.deepEqual(ramp(loose, 0.37), [...fades(loose, 0.37)]);
  }
});
