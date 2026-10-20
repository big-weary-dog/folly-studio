// The rose's regions on City of Gods (SPEC "Directions"): the petal and ring directions, the stdlib's region() and
// regions(), mask by region, and scroll a petal at a time.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { STDLIB } from '../public/js/pattern-core.ts';
import { at, COG, layerOn } from './fixtures/layers.js';

const { toward, region, regions } = STDLIB;
const WHITE = ['white', {}, 'function pixel() { return 1; }'];
const ROSE = layerOn(['rose-window'], WHITE).idx;
const pane = (k) => ({ sector: COG.sector[k], ring: COG.ring[k] });

describe('petal and ring directions', () => {
  test('step a petal (clockwise) or a ring (heart to rim) on the rose, round and out off it', () => {
    const p = { lx: 0, ly: 0, lz: 0, a: 0.3, r: 0.6, u: 0, sector: 3, ring: 2 };
    assert.equal(toward(p, 'petal'), 3.5 / 16);
    assert.equal(toward(p, 'ring'), 1.5 / 7);
    const off = { ...p, sector: -1, ring: 0 };
    assert.equal(toward(off, 'petal'), 0.3);
    assert.equal(toward(off, 'ring'), 0.6);
  });
});

describe('region()', () => {
  test('every pane of the rose falls in one of regions(rule, size), and off the rose in none', () => {
    for (const rule of ['petal', 'alternate', 'ring', 'rings', 'centre', 'spiral', 'wedges', 'checker', 'random']) {
      for (const size of [1, 2, 4]) {
        const seen = new Set();
        for (const k of ROSE) {
          const i = region(pane(k), rule, size, 3);
          assert.ok(Number.isInteger(i) && i >= 0 && i < regions(rule, size), `${rule} ${size}: ${i}`);
          seen.add(i);
        }
        if (rule !== 'random') assert.equal(seen.size, regions(rule, size), `${rule} ${size} uses every region`);
      }
    }
    assert.equal(region({ sector: -1, ring: 0 }, 'petal'), -1);
  });

  test('a spiral arm winds round: each ring out, one petal on, and it wraps past the last petal', () => {
    for (let ring = 1; ring < 7; ring++) {
      for (let s = 0; s < 16; s++) {
        assert.equal(region({ sector: s, ring }, 'spiral', 2), region({ sector: (s + 15) % 16, ring: ring + 1 },
          'spiral', 2));
      }
    }
  });
});

describe('mask by region', () => {
  const shown = (params) => {
    const L = at(layerOn(['rose-window'], WHITE, ['mask', { by: 'region', softness: 0.01, ...params }]), 1);
    return Array.from(L.idx, (k, j) => [k, L.buf[4 * j + 3]]);
  };

  test('odd petals show and even ones go transparent', () => {
    for (const [k, alpha] of shown({ rule: 'petal', pick: 'odd' })) assert.equal(alpha, COG.sector[k] % 2, `${k}`);
  });

  test('one spiral arm, every third ring, or the rest (invert)', () => {
    for (const [k, alpha] of shown({ rule: 'spiral', size: 2, pick: 'one', index: 3 })) {
      assert.equal(alpha, +(region(pane(k), 'spiral', 2) === 3));
    }
    for (const [k, alpha] of shown({ rule: 'ring', pick: 'every', index: 3, invert: true })) {
      assert.equal(alpha, +((COG.ring[k] - 1) % 3 !== 0));
    }
  });

  test('softness fades a pane toward the next petal: it lies between the two', () => {
    const soft = shown({ rule: 'petal', pick: 'odd', softness: 1 });
    assert.ok(soft.some(([, a]) => a > 0.05 && a < 0.95) && soft.every(([, a]) => a >= 0 && a <= 1));
  });
});

test('scroll by petal turns the rose a whole petal at a time', () => {
  const angle = ['angle', {}, 'function pixel(q) { return [q.a, 0, 0]; }'];
  const colours = (t) => {
    const L = at(layerOn(['rose-window'], angle, ['scroll', { direction: 'petal', speed: 0.1 }],
      ['anchor', { tag: 'rose' }]), t);
    const by = new Map();
    L.idx.forEach((k, j) => by.set(k, L.buf[4 * j]));
    return by;
  };
  const before = colours(0), after = colours(1);    // clock 0.1: 1.6 petals, so one whole petal
  for (const k of ROSE) assert.ok(Math.abs(after.get(k) - (before.get(k) + 15 / 16) % 1) < 1e-9, `${k}`);
});
