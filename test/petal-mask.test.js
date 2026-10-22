// Petal mask (SPEC "Library"): the rose petals a `petals` text names, and in them the cells a `cells` text names,
// show, the rest go transparent; off the rose, the sixteenth of a turn round the layer's centre stands in for a petal.
// Each cell found by ring and side on both rigs; and the pickers' reading and writing of them.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { readFileSync } from 'node:fs';

import { compileLayer, prepareLayer, prepareScene, renderFrame } from '../public/js/pattern-core.ts';
import { pickText, readPicks } from '../public/js/ui/bindings.ts';
import { at, COG, layerOf, layerOn } from './fixtures/layers.js';
import { cog, folly } from './fixtures/rigs.js';

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

// Cell k's ring (1 at the heart) and its place across that ring, from the counterclockwise side, of how many.
const CELLS = [[1, 0, 1], [2, 0, 2], [2, 1, 2], [3, 0, 1], [4, 0, 2], [4, 1, 2], [5, 0, 3], [5, 1, 3], [5, 2, 3],
  [6, 0, 2], [6, 1, 2], [7, 0, 3], [7, 1, 3], [7, 2, 3]];
const code = readFileSync(new URL('../public/patterns/petal-mask.js', import.meta.url), 'utf8');

describe('cells', () => {
  for (const [name, rig] of Object.entries({ cog, folly })) {
    test(`on ${name}, each cell is one LED a petal, in its ring, in order from the counterclockwise side`, () => {
      const scene = prepareScene(rig), rose = rig.groups.find((g) => g.tags?.includes('rose'));
      const seen = new Map();
      CELLS.forEach(([ring, across, of], k) => {
        const layer = { id: 'l', groups: [rose.id], modules: [
          { id: 'a', kind: 'source', code: 'function pixel() { return 1; }', params: {} },
          { id: 'b', kind: 'filter', ref: 'petal-mask', code, params: { petals: '1-16', cells: `${k + 1}` } }] };
        const L = prepareLayer(scene, layer, compileLayer(layer));
        assert.deepEqual(renderFrame(scene, [L], 0).errors, []);
        const lit = L.idx.filter((_, j) => L.buf[4 * j + 3] === 1);
        assert.equal(lit.length, 16, `cell ${k + 1}: one LED a petal`);
        for (const i of lit) {
          assert.equal(scene.ring[i], ring, `cell ${k + 1}`);
          assert.ok(!seen.has(i), `LED ${i} in cells ${seen.get(i)} and ${k + 1}`);
          seen.set(i, k + 1);
          const [, Y, Z] = rig.pixels.pos.slice(3 * i, 3 * i + 3), [, cy, cz] = rose.centre;
          const o = ((Math.atan2(Z - cz, Y - cy) / Math.PI * 8 - scene.sector[i]) % 16 + 24) % 16 - 8;
          if (of > 1) assert.ok(across === 0 ? o < -0.15 : across === of - 1 ? o > 0.15 : Math.abs(o) < 0.15);
        }
      });
      assert.equal(seen.size, 16 * 14);
    });
  }

  test('off the rose, a ring of two splits at the centre line, and a ring of three in thirds', () => {
    for (const [cells, band, show] of [['2', 2, (o) => o < 0], ['3', 2, (o) => o >= 0],
      ['7', 5, (o) => o < -1 / 6], ['8', 5, (o) => Math.abs(o) <= 1 / 6]]) {
      const L = at(layerOf(WHITE, ['petal-mask', { petals: '1-16', cells, softness: 0.01 }]), 1);
      let near = 0;
      L.idx.forEach((k, j) => {
        if (COG.sector[k] >= 0) return;
        const o = ((L.a[j] * 16 + 0.5) % 1) - 0.5, inBand = Math.min(7, Math.floor(L.r[j] * 7) + 1) === band;
        if (inBand && Math.abs(o) < 1 / 6 && Math.abs(o) > 0.02) near++;
        if (Math.abs(Math.abs(o) - 1 / 6) > 1e-3 && Math.abs(o) > 1e-3) {
          assert.equal(L.buf[4 * j + 3], +(inBand && show(o)), `cells ${cells}: LED ${k}, o ${o}`);
        }
      });
      assert.ok(near > 0, `cells ${cells}: LEDs near the centre line`);
    }
  });

  test('a cell shows only where its petal shows too', () => {
    const on = petals(1, 5);
    for (const [k, alpha] of shown({ petals: '1 5', cells: '1-3' })) {
      assert.equal(alpha, +(on.has(COG.sector[k]) && COG.ring[k] <= 2), `${k}`);
    }
  });
});

describe('the pickers', () => {
  test('read numbers and wrapping runs, as the pattern does, and write them sorted, runs of three as a-b', () => {
    const on = readPicks('16 1-3, 7 9 10 x 40', 16);
    assert.deepEqual(on.flatMap((o, i) => (o ? [i + 1] : [])), [1, 2, 3, 7, 9, 10, 16]);
    assert.equal(pickText(on), '1-3 7 9 10 16');
    assert.equal(pickText(readPicks('15-2', 16)), '1 2 15 16');
    assert.equal(pickText(readPicks('', 16)), '');
    assert.equal(pickText(readPicks('1-16', 16)), '1-16');
    assert.equal(pickText(readPicks('13-2 16', 14)), '1 2 13 14');
  });
});
