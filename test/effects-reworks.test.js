// The effects audit's reworks on City of Gods: each group's own height (p.partUp), lightning a bolt that fades in its
// own time, mosaic's runs, recolour's Steps snapping to a Colours pick, and mirror's Wedges on the rose's petals.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { tagParts } from '../public/js/core/scene.ts';
import { at, COG, layerOf, layerOn, litShare } from './fixtures/layers.js';

describe('p.partUp', () => {
  test('each part runs 0 at its own foot to 1 at its own top', () => {
    const { of, n, up } = tagParts(COG, 'arch'), lo = new Array(n).fill(1), hi = new Array(n).fill(0);
    for (let k = 0; k < COG.count; k++) {
      if (of[k] >= 0) { lo[of[k]] = Math.min(lo[of[k]], up[k]); hi[of[k]] = Math.max(hi[of[k]], up[k]); }
    }
    assert.ok(lo.every((v) => v < 1e-6) && hi.every((v) => v > 1 - 1e-6), `${lo} ${hi}`);
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
  test('runs: LEDs along a strand share a colour in runs of LEDs per run', () => {
    const runs = new Map(), smooth = ['bars', { profile: 'smooth' }];
    const L = at(layerOf(smooth, ['mosaic', { leds: 5 }]), 1.3);
    L.idx.forEach((k, j) => {
      if (COG.n[k] < 10) return;
      const key = `${COG.fixture[k]}:${Math.floor(COG.i[k] / 5)}`;
      (runs.get(key) ?? runs.set(key, new Set()).get(key)).add(L.buf[4 * j].toFixed(5));
    });
    assert.ok(runs.size > 50 && [...runs.values()].every((s) => s.size === 1), 'one colour a run');
  });
});

describe('recolour steps', () => {
  test('snaps to the bands of a Colours pick, not to RGB primaries', () => {
    const hues = new Set(), smooth = ['bars', { profile: 'smooth' }];
    const L = at(layerOf(smooth, ['recolour', { steps: 3, colours: 'body' }]), 1.3);
    L.idx.forEach((_, j) => {
      const c = [0, 1, 2].map((i) => L.buf[4 * j + i]), m = Math.max(...c);
      if (m > 0.01) hues.add(c.map((v) => (v / m).toFixed(3)).join());
    });
    assert.ok(hues.size <= 3, `${hues.size} colours: ${[...hues]}`);
  });
});

describe('mirror wedges', () => {
  test('8 wedges on the rose fold at petal edges: neighbouring petals mirror, a petal\'s panes differ', () => {
    const angle = 'function pixel(q) { return [0.5 + 0.5 * sin(TAU * q.a * 4), 0, 0.5]; }';
    const L = at(layerOn(['rose-window'], ['angle', {}, angle], ['mirror', { across: false, wedges: 8 }],
      ['anchor', { tag: 'rose' }]), 1);
    const petal = new Map();                        // sector:ring → its panes' colours
    L.idx.forEach((k, j) => {
      const key = `${COG.sector[k]}:${COG.ring[k]}`, c = L.buf[4 * j];
      (petal.get(key) ?? petal.set(key, []).get(key)).push(c);
    });
    // The rig's petals sit a hair off true, so mirrored panes match to within 0.03 (a misfold is off by 0.3).
    const panes = (s, ring) => [...petal.get(`${s}:${ring}`)].sort((x, y) => x - y);
    const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.03);
    for (let ring = 1; ring <= 7; ring++) {
      for (let s = 0; s < 16; s++) {
        const own = petal.get(`${s}:${ring}`);     // one to three panes, centred on the petal: the fold is not
        if (own.length === 2) assert.ok(Math.abs(own[0] - own[1]) > 0.05, `petal ${s} ring ${ring}: panes differ`);
        assert.ok(same(panes(s, ring), panes(s ^ 1, ring)), `petal ${s} ring ${ring} mirrors its neighbour`);
        assert.ok(same(panes(s, ring), panes((s + 2) % 16, ring)), `petal ${s} ring ${ring} repeats two on`);
      }
    }
  });
});
