// In turn on City of Gods: the modules above it run on each instance's own time (t and clock()), seen through its
// gate's envelope; drops take the youngest that has spread to a pixel, in a frame round it.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { tagParts } from '../public/js/core/scene.ts';
import { at, COG, layerOf } from './fixtures/layers.js';

// A probe: red its t / 10, green its clock / 10 (speed 1), blue its r, all opaque.
const probe = ['probe', { speed: 1 },
  'const params = { speed: { value: 1, min: 0, max: 2 } };\n'
  + 'function pixel(p, t) { return [t / 10, clock(\'speed\') / 10, p.r, 1]; }'];
const near = (a, b) => Math.abs(a - b) < 1e-6;

describe('the modules above it run on the instance\'s time', () => {
  test('each arch\'s t and clock() are its age: show time less its start', () => {
    const L = at(layerOf(probe, ['in-turn', { gate: 'flash', attack: 0, hold: 9, release: 0 }]), 2.25);
    const { of, n } = tagParts(COG, 'arch');
    L.idx.forEach((k, j) => {
      if (of[k] < 0) return;
      const age = (((2.25 - of[k]) % n) + n) % n;
      assert.ok(near(L.buf[4 * j] * 10, Math.min(age, 10)) && near(L.buf[4 * j + 1], L.buf[4 * j]), `LED ${k}`);
    });
  });

  test('below it, show time', () => {
    const L = at(layerOf(['in-turn', {}], probe), 2.25);
    L.idx.forEach((k, j) => assert.ok(near(L.buf[4 * j], 0.225) && L.buf[4 * j + 3] === 1, `LED ${k}`));
  });
});

test('the gate opens over attack, holds, and fades over release', () => {
  const env = { start: 'together', every: 10, gate: 'flash', attack: 1, hold: 1, release: 1 };
  for (const [t, want] of [[0.5, 0.5], [1.5, 1], [2.5, 0.5], [3.5, 0]]) {
    const L = at(layerOf(probe, ['in-turn', { ...env, tag: 'tower' }]), t), { of } = tagParts(COG, 'tower');
    L.idx.forEach((k, j) => assert.ok(near(L.buf[4 * j + 3], of[k] < 0 ? 0 : want), `${t}: LED ${k}`));
  }
});

test('drops: each lit pixel is in its drop\'s frame, no farther out than the drop has spread', () => {
  const drops = { each: 'drops', drops: 5, every: 0.5, gate: 'flash', attack: 0, hold: 9, release: 0 };
  for (const t of [1, 3.3, 7.9]) {
    const L = at(layerOf(probe, ['in-turn', drops]), t);
    let lit = 0;
    L.idx.forEach((k, j) => {
      if (L.buf[4 * j + 3] === 0) return;
      lit++;
      const age = L.buf[4 * j] * 10, r = L.buf[4 * j + 2];
      assert.ok(age >= 0 && age < 2.5 && r <= Math.min(1, age / 2.5 + 0.08) + 1e-9, `${t}: LED ${k}: ${age}, ${r}`);
    });
    assert.ok(lit > 0, `${t}: some drop lit`);
  }
});
