// Petal mask (SPEC "Library"): the rose petals a `petals` text names show, the rest go transparent; off the rose, the
// sixteenth of a turn round the layer's centre stands in for a petal. And the picker's reading and writing of them.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { petalText, readPetals } from '../public/js/ui/bindings.ts';
import { at, COG, layerOf, layerOn } from './fixtures/layers.js';

const WHITE = ['white', {}, 'function pixel() { return 1; }'];
const shown = (params, groups = ['rose-window']) => {
  const L = at(layerOn(groups, WHITE, ['petal-mask', { softness: 0.01, ...params }]), 1);
  return Array.from(L.idx, (k, j) => [k, L.buf[4 * j + 3]]);
};
const petals = (...n) => new Set(n.map((p) => p - 1));

describe('petal mask', () => {
  test('exactly the petals named show, numbers and runs, petal 1 the top one', () => {
    const on = petals(1, 3, 9, 10, 11, 12);
    for (const [k, alpha] of shown({ petals: '1 3 9-12' })) assert.equal(alpha, +on.has(COG.sector[k]), `${k}`);
  });

  test('a run wraps past 16; invert shows the rest; strength leaves a ghost', () => {
    const on = petals(15, 16, 1, 2);
    for (const [k, alpha] of shown({ petals: '15-2', invert: true })) assert.equal(alpha, +!on.has(COG.sector[k]));
    for (const [k, alpha] of shown({ petals: '15-2', amount: 0.75 })) {
      assert.ok(Math.abs(alpha - (on.has(COG.sector[k]) ? 1 : 0.25)) < 1e-6);
    }
  });

  test('nothing named hides the rose; bad words are skipped', () => {
    assert.ok(shown({ petals: '' }).every(([, a]) => a === 0));
    assert.deepEqual(shown({ petals: '0 17 x 5-99 2' }), shown({ petals: '2' }));
  });

  test('softness fades a petal toward the next: between the two, never past them', () => {
    const soft = shown({ petals: '1-4 9-12', softness: 1 });
    assert.ok(soft.some(([, a]) => a > 0.05 && a < 0.95) && soft.every(([, a]) => a >= 0 && a <= 1));
  });

  test('off the rose, the sixteenth of a turn round the layer centre stands in for the petal', () => {
    const L = at(layerOf(WHITE, ['petal-mask', { petals: '1-8', softness: 0.01 }]), 1);
    const off = Array.from(L.idx, (k, j) => [k, L.buf[4 * j + 3]]).filter(([k]) => COG.sector[k] < 0);
    const lit = off.filter(([, a]) => a === 1).length;
    assert.ok(off.length && lit > 0 && lit < off.length, `${lit} of ${off.length}`);
  });
});

describe('the petal picker', () => {
  test('reads numbers and wrapping runs, as the pattern does, and writes them sorted, runs of three as a-b', () => {
    const on = readPetals('16 1-3, 7 9 10 x 40');
    assert.deepEqual(on.flatMap((o, i) => (o ? [i + 1] : [])), [1, 2, 3, 7, 9, 10, 16]);
    assert.equal(petalText(on), '1-3 7 9 10 16');
    assert.equal(petalText(readPetals('15-2')), '1 2 15 16');
    assert.equal(petalText(readPetals('')), '');
    assert.equal(petalText(readPetals('1-16')), '1-16');
  });
});
