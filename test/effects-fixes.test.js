// The effects audit's small fixes on City of Gods: what each source's params now promise.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { at, COG, layerOf, litShare } from './fixtures/layers.js';

/** Each lit LED's colour over its brightest channel, as a key. */
const hue = (L, j) => {
  const c = [0, 1, 2].map((i) => L.buf[4 * j + i]), m = Math.max(...c);
  return m > 0.02 ? c.map((v) => (v / m).toFixed(2)).join() : null;
};

describe('clouds', () => {
  test('Cover runs from a few wisps to overcast, without a flat sheet before the end', () => {
    const [none, most, all] = [0, 0.7, 1].map((cover) => litShare(at(layerOf(['clouds', { cover }]), 3), 0.05));
    assert.ok(none > 0.05 && none < 0.2 && most < 0.9 && all > 0.9, `cover 0: ${none}, 0.7: ${most}, 1: ${all}`);
  });
});

describe('curtain', () => {
  test('it opens steadily all the way: open 0.9 still shows cloth, open 1 is clear', () => {
    const shares = [0, 0.5, 0.75, 0.9, 1].map((open) => litShare(at(layerOf(['curtain', { open }]), 1), 0.002));
    assert.ok(shares.every((s, i) => i === 0 || s < shares[i - 1]) && shares[3] > 0.02 && shares[4] === 0, `${shares}`);
  });
});

describe('circles', () => {
  test('balls blend their colours where they meet', () => {
    const L = at(layerOf(['circles', { count: 3, size: 0.25 }]), 2), hues = new Set();
    L.idx.forEach((_, j) => { const h = L.buf[4 * j + 3] > 0.5 && hue(L, j); if (h) hues.add(h); });
    assert.ok(hues.size > 10, `${hues.size} colours`);
  });
});

describe('chase', () => {
  // Spire strands (44 LEDs) at 20 LEDs a second: a bounce goes out over 2.2 s and comes back over the next 2.2.
  test('a bouncing comet flies head first both ways', () => {
    for (const [t, back] of [[1, false], [3, true]]) {
      const L = at(layerOf(['single-strand', { mode: 'bounce', profile: 'comet', size: 10, tail: 3 }]), t);
      const a = new Map(), heads = [], wrong = [];
      L.idx.forEach((k, j) => a.set(`${COG.fixture[k]}:${COG.i[k]}`, L.buf[4 * j + 3]));
      L.idx.forEach((k, j) => {
        const f = COG.fixture[k], i = COG.i[k], v = L.buf[4 * j + 3];
        if (COG.n[k] !== 44 || i < 1 || i > 42) return;
        const lo = a.get(`${f}:${i - 1}`), hi = a.get(`${f}:${i + 1}`);
        if (v < 0.3 || v < lo || v < hi) return;                       // a head: brighter than both neighbours
        heads.push(i);
        if (back ? hi <= lo : lo <= hi) wrong.push(`${f}:${i}`);       // its tail is the brighter side, behind it
      });
      assert.ok(heads.length > 10 && !wrong.length, `t ${t}: ${wrong.length} of ${heads.length} heads tail-first`);
    }
  });
});

describe('sparkle', () => {
  test('a pulse glint takes a new colour each time', () => {
    const L = layerOf(['sparkle', { rate: 2 }]), seen = new Map();
    for (let f = 0; f < 200; f++) {
      at(L, f / 20).idx.forEach((k, j) => {
        const h = L.buf[4 * j + 3] > 0.5 && hue(L, j);
        if (h) (seen.get(k) ?? seen.set(k, new Set()).get(k)).add(h);
      });
    }
    const many = [...seen.values()].filter((s) => s.size > 1).length;
    assert.ok(many > seen.size / 2, `${many} of ${seen.size} LEDs changed colour`);
  });
});

describe('fire', () => {
  test('Embers adds sparks above the flames', () => {
    const share = (embers) => [1, 2, 3].reduce((s, t) => s + litShare(at(layerOf(['fire', { embers }]), t), 0.1), 0);
    const none = share(0), full = share(1);
    assert.ok(full - none > 0.06, `embers 0: ${none / 3}, 1: ${full / 3}`);
  });
});
