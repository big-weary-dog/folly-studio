// The effects audit's reworks on City of Gods: climb by each group's own height in order (p.partUp), lightning a bolt
// that fades in its own time, mosaic's blocks or runs, and posterize snapping to a Colours pick.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { tagParts } from '../public/js/core/scene.ts';
import { at, COG, layerOf, litShare } from './fixtures/layers.js';

describe('p.partUp', () => {
  test('each part runs 0 at its own foot to 1 at its own top', () => {
    const { of, n, up } = tagParts(COG, 'arch'), lo = new Array(n).fill(1), hi = new Array(n).fill(0);
    for (let k = 0; k < COG.count; k++) {
      if (of[k] >= 0) { lo[of[k]] = Math.min(lo[of[k]], up[k]); hi[of[k]] = Math.max(hi[of[k]], up[k]); }
    }
    assert.ok(lo.every((v) => v < 1e-6) && hi.every((v) => v > 1 - 1e-6), `${lo} ${hi}`);
  });
});

describe('climb', () => {
  test('every arch climbs its own height: halfway up, each arch is lit to its own middle', () => {
    // stagger 0: all together; ph 0.3 puts the head at smoothstep(0, 0.6, 0.3) * 1.1 = 0.55 of each arch
    const L = at(layerOf(['climb', { tag: 'arch', stagger: 0, speed: 0.25 }]), 1.2);
    const { of, up } = tagParts(COG, 'arch'), wrong = [];
    L.idx.forEach((k, j) => {
      const a = L.buf[4 * j + 3];
      if (of[k] >= 0 && ((up[k] < 0.4 && a < 0.5) || (up[k] > 0.7 && a > 0.05))) wrong.push(k);
    });
    assert.deepEqual(wrong, [], 'lit low in its arch, dark high in it');
  });

  test('the arches start one after another, in rig order', () => {
    // stagger 0.5 at 0.55 rises: the first arch is near its top, each later one lower, the last just starting
    const L = at(layerOf(['climb', { tag: 'arch', stagger: 0.5, speed: 0.25 }]), 2.2);
    const { of, n } = tagParts(COG, 'arch'), sum = new Array(n).fill(0), count = new Array(n).fill(0);
    L.idx.forEach((k, j) => { if (of[k] >= 0) { sum[of[k]] += L.buf[4 * j + 3]; count[of[k]]++; } });
    const lit = sum.map((s, i) => s / count[i]);
    assert.ok(lit.every((v, i) => i === 0 || v <= lit[i - 1] + 1e-9) && lit[0] > lit[n - 1] + 0.3, `${lit}`);
  });
});

describe('lightning', () => {
  // Frames lit over 8 s at 40 fps: how much of the rig each lights, and how long each strike lasts.
  function strikes(speed) {
    const L = layerOf(['lightning', { speed }]), shares = [];
    for (let f = 0; f < 320; f++) shares.push(litShare(at(L, f / 40), 0.2));
    let longest = 0, run = 0;
    for (const s of shares) { run = s > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
    return { most: Math.max(...shares), seconds: longest / 40 };
  }

  test('a bolt, not a flood: no strike lights more than a quarter of the rig', () => {
    const { most } = strikes(0.4);
    assert.ok(most > 0 && most < 0.25, `most lit ${most}`);
  });

  test('a strike fades in its own time, whatever the speed', () => {
    const slow = strikes(0.1).seconds, fast = strikes(0.8).seconds;
    assert.ok(slow > 0.3 && slow < 1.6 && Math.abs(slow - fast) < 0.5, `slow ${slow} s, fast ${fast} s`);
  });
});

describe('mosaic', () => {
  test('blocks: every LED in a block takes one colour', () => {
    const L = at(layerOf(['plasma'], ['mosaic', { cells: 4 }]), 1.3), blocks = new Map();
    L.idx.forEach((k, j) => {
      const key = [L.lx[j], L.ly[j], L.lz[j]].map((v) => Math.floor(v * 4)).join();
      const c = [0, 1, 2].map((i) => L.buf[4 * j + i].toFixed(5)).join();
      (blocks.get(key) ?? blocks.set(key, new Set()).get(key)).add(c);
    });
    assert.ok([...blocks.values()].every((s) => s.size === 1), 'one colour a block');
  });

  test('runs: LEDs along a strand share a colour in runs of LEDs per run', () => {
    const L = at(layerOf(['plasma'], ['mosaic', { shape: 'runs', leds: 5 }]), 1.3), runs = new Map();
    L.idx.forEach((k, j) => {
      if (COG.n[k] < 10) return;
      const key = `${COG.fixture[k]}:${Math.floor(COG.i[k] / 5)}`;
      (runs.get(key) ?? runs.set(key, new Set()).get(key)).add(L.buf[4 * j].toFixed(5));
    });
    assert.ok(runs.size > 50 && [...runs.values()].every((s) => s.size === 1), 'one colour a run');
  });
});

describe('posterize', () => {
  test('snaps to the bands of a Colours pick, not to RGB primaries', () => {
    const L = at(layerOf(['plasma'], ['posterize', { steps: 3, colours: 'body' }]), 1.3), hues = new Set();
    L.idx.forEach((_, j) => {
      const c = [0, 1, 2].map((i) => L.buf[4 * j + i]), m = Math.max(...c);
      if (m > 0.01) hues.add(c.map((v) => (v / m).toFixed(3)).join());
    });
    assert.ok(hues.size <= 3, `${hues.size} colours: ${[...hues]}`);
  });
});
