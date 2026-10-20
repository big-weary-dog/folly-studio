// Smoke, Replay and Sort (SPEC-library "History", "Spatial modules"): a trail that drifts along the wire and fades,
// the last moments replayed (loop, reverse, bounce, hold, in beats), and colours sorted along each strand.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { at, COG, layerOf, layerOn } from './fixtures/layers.js';

// White for a twentieth of a second from t = 1, else nothing.
const flash = ['flash', {}, 'function pixel(p, t) { return t >= 1 && t < 1.05 ? [1, 1, 1, 1] : null; }'];
// One spire LED (the third from its foot) lit for the first tenth of a second.
const puff = ['puff', {}, 'function pixel(p, t) { return p.i === 2 && t < 0.1 ? [1, 0.5, 0.2, 1] : null; }'];
const alpha = (L, j) => L.buf[4 * j + 3];
const lum = (L, j) => (0.2126 * L.buf[4 * j] + 0.7152 * L.buf[4 * j + 1] + 0.0722 * L.buf[4 * j + 2]) * alpha(L, j);
const lit = (L) => L.idx.every((_, j) => alpha(L, j) > 0.5);
const dark = (L) => L.idx.every((_, j) => !(alpha(L, j) > 0.5));
/** L played from `from` to `to` at `fps`. */
function play(L, to, fps = 40, from = 0) {
  for (let f = Math.round(from * fps); f <= Math.round(to * fps); f++) at(L, f / fps);
  return L;
}
/** The layer's pixels on fixture `f`, foot first (by index along it). */
const strand = (L, f) => L.idx.reduce((a, k, j) => (COG.fixture[k] === f ? [...a, j] : a), [])
  .sort((a, b) => COG.i[L.idx[a]] - COG.i[L.idx[b]]);
/** Where a strand's light sits, as the mean of its LEDs' index weighted by alpha. */
const middle = (L, js) => js.reduce((s, j, i) => s + i * alpha(L, j), 0) / js.reduce((s, j) => s + alpha(L, j), 0);

describe('smoke', () => {
  const spire = () => strand(layerOn(['spire-back-left']), COG.fixture[layerOn(['spire-back-left']).idx[0]]);

  test('a puff drifts up the strand, spreads and fades; down drips the other way', () => {
    const js = spire();
    const up = play(layerOn(['spire-back-left'], puff, ['smoke', { direction: 'up', drift: 1, fade: 0.2 }]), 1);
    const down = play(layerOn(['spire-back-left'], puff, ['smoke', { direction: 'down', drift: 1, fade: 0.2 }]), 1);
    assert.ok(middle(up, js) > 3, `up: ${middle(up, js)}`);
    assert.ok(middle(down, js) < 1.5, `down: ${middle(down, js)}`);
    const peak = Math.max(...js.map((j) => alpha(up, j)));
    assert.ok(peak > 0.05 && peak < 0.9, `faded and spread: ${peak}`);
  });

  test('with no drift or spread it stays put and fades; fade 1 clears it in a moment', () => {
    const js = spire();
    const still = (fade) => layerOn(['spire-back-left'], puff, ['smoke', { drift: 0, spread: 0, curl: 0, fade }]);
    const S = play(still(0.3), 0.5);
    assert.ok(alpha(S, js[2]) > 0.2 && js.every((j, i) => i === 2 || alpha(S, j) < 1e-6));
    const before = alpha(S, js[2]);
    play(S, 1, 40, 0.525);
    assert.ok(alpha(S, js[2]) < before);
    assert.ok(alpha(play(still(1), 1), js[2]) < 1e-3);
  });

  test('on an arch, up is height: both legs drift toward the apex, not along the wire', () => {
    const feet = ['feet', {},
      'function pixel(p, t) { return (p.u < 0.1 || p.u > 0.9) && t < 0.2 ? [1, 1, 1, 1] : null; }'];
    const L = play(layerOn(['main-arch-1'], feet, ['smoke', { drift: 3, fade: 0, spread: 0, curl: 0 }]), 4);
    const js = strand(L, COG.fixture[L.idx[0]]), n = js.length;
    const lit = (a, b) => js.slice(a, b).some((j) => alpha(L, j) > 0.01);
    assert.ok(lit(0.2 * n | 0, 0.4 * n | 0) && lit(0.6 * n | 0, 0.8 * n | 0), 'up both legs');
  });

  test('time going back clears it to what is drawn now', () => {
    const L = play(layerOn(['spire-back-left'], puff, ['smoke', { fade: 0.1 }]), 1);
    assert.ok(L.idx.some((_, j) => alpha(L, j) > 0.01));
    assert.ok(at(L, 0.5) && L.idx.every((_, j) => alpha(L, j) === 0));
  });
});

describe('replay', () => {
  const replay = (params) => layerOf(flash, ['replay', { beats: false, ...params }]);

  test('loop repeats the Length before each Hold, until the next', () => {
    const L = replay({ play: 'loop', length: 1, hold: 2 });
    assert.ok(lit(play(L, 2.025)), 'the flash, a second on');
    assert.ok(dark(play(L, 2.5, 40, 2.05)));
    assert.ok(lit(play(L, 3.025, 40, 2.525)), 'and again');
    assert.ok(dark(play(L, 4.025, 40, 3.05)), 'moved on: the next window has no flash');
  });

  test('reverse runs back from each Hold; bounce comes back; hold freezes the frame at its start', () => {
    const R = replay({ play: 'reverse', length: 1, hold: 2 });
    assert.ok(dark(play(R, 2.5)) && lit(play(R, 2.975, 40, 2.525)));
    const B = replay({ play: 'bounce', length: 1, hold: 2 });
    assert.ok(dark(play(B, 2.5)) && lit(play(B, 3.025, 40, 2.525)) && dark(play(B, 3.5, 40, 3.05)));
    const H = replay({ play: 'hold', hold: 0.5 });
    assert.ok(lit(play(H, 1.4)) && dark(play(H, 1.6, 40, 1.425)));
  });

  test('in beats it counts the tempo (120 unset); cuts come no faster than a quarter second', () => {
    const a = play(layerOf(flash, ['replay', { beats: true, length: 2, hold: 4 }]), 3.2);
    const b = play(replay({ length: 1, hold: 2 }), 3.2);
    assert.deepEqual([...a.buf], [...b.buf]);
    const short = play(replay({ length: 0.05, hold: 2 }), 3.2), quarter = play(replay({ length: 0.25, hold: 2 }), 3.2);
    assert.deepEqual([...short.buf], [...quarter.buf]);
  });

  test('Mix 0 is what is above it, exactly', () => {
    const D = play(replay({ amount: 0 }), 2.5), S = play(layerOf(flash), 2.5);
    assert.deepEqual([...D.buf], [...S.buf]);
  });
});

describe('sort', () => {
  // Brightest at the foot of every strand, a rainbow along it, and a dark LED at the middle of each.
  const ramp = ['ramp', {},
    'function pixel(p) { return p.i === 6 ? [0, 0, 0, 1] : [...hsv(p.u * 0.5, 1, 1 - p.u), 1]; }'];
  const sorted = (params, groups = ['spire-back-left']) => at(layerOn(groups, ramp, ['sort', params]), 0);

  test('up: along each run the brightness climbs with height; dark LEDs stay and split the runs', () => {
    const L = sorted({ direction: 'up', cutoff: 0.01 }), js = strand(L, COG.fixture[L.idx[0]]);
    assert.equal(lum(L, js[6]), 0);
    for (const run of [js.slice(0, 6), js.slice(7, 12)]) {
      for (let i = 1; i < run.length; i++) assert.ok(lum(L, run[i]) >= lum(L, run[i - 1]), `at ${i}`);
    }
  });

  test('start gathers the bright at the wire start; colour orders hues; on an arch, up piles at the top', () => {
    const S = sorted({ direction: 'start', cutoff: 0 }), js = strand(S, COG.fixture[S.idx[0]]);
    for (let i = 1; i < 6; i++) assert.ok(lum(S, js[i]) <= lum(S, js[i - 1]));
    const A = sorted({ direction: 'up', cutoff: 0 }, ['main-arch-1']);
    const top = A.idx.reduce((b, k, j) => (COG.Y[k] > COG.Y[A.idx[b]] ? j : b), 0);
    const brightest = A.idx.reduce((b, _, j) => (lum(A, j) > lum(A, b) ? j : b), 0);
    assert.ok(Math.abs(COG.Y[A.idx[top]] - COG.Y[A.idx[brightest]]) < 0.05);
    const H = sorted({ by: 'colour', direction: 'end', cutoff: 0.01 }), hs = strand(H, COG.fixture[H.idx[0]]);
    const hue = (j) => {
      const [r, g, b] = H.buf.slice(4 * j, 4 * j + 3);
      return Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b);
    };
    assert.ok(hue(hs[5]) >= hue(hs[0]));
  });

  test('Amount 0 leaves it exactly as it was', () => {
    const L = sorted({ amount: 0 }), S = at(layerOn(['spire-back-left'], ramp), 0);
    assert.deepEqual([...L.buf], [...S.buf]);
  });
});
