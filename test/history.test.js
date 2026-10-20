// The frame buffer (SPEC-library "History") and Delay, the first filter on it: past() reads what was above a filter
// at its LED any time back, on the grid's blend at any render rate; time going back starts it again.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { compileModule } from '../public/js/pattern-core.ts';
import { at, layerOf } from './fixtures/layers.js';

// White for a twentieth of a second from t = 1, else nothing.
const flash = ['flash', {}, 'function pixel(p, t) { return t >= 1 && t < 1.05 ? [1, 1, 1, 1] : null; }'];
// A slow, smooth wave that moves down the layer.
const drift = ['drift', {}, 'function pixel(p, t) { return [wave(p.ly + 0.2 * t), 0.5, 0.2, 1]; }'];
const alpha = (L, j) => L.buf[4 * j + 3];
/** The layer's LEDs nearest the bottom, middle and top (by ly). */
function ends(L) {
  const by = (want) => L.idx.reduce((b, _, j) => (Math.abs(L.ly[j] - want) < Math.abs(L.ly[b] - want) ? j : b), 0);
  return [by(0), by(0.5), by(1)];
}
/** L played from 0 to `to` at `fps`. */
function play(L, to, fps = 40) {
  for (let f = 0; f <= Math.round(to * fps); f++) at(L, f / fps);
  return L;
}

describe('delay', () => {
  test('a flash sweeps up: the bottom at once, the middle half a Longest later, the top a Longest later', () => {
    const L = layerOf(flash, ['delay', { direction: 'up', longest: 1 }]);
    const [lo, mid, hi] = ends(L);
    const lit = (t) => { play(L, t); return [lo, mid, hi].map((j) => alpha(L, j) > 0.5); };
    assert.deepEqual(lit(1.025), [true, false, false]);
    assert.deepEqual(lit(1.525), [false, true, false]);
    assert.deepEqual(lit(2.025), [false, false, true]);
  });

  test('Longest 0 is what is above it, exactly', () => {
    const D = play(layerOf(drift, ['delay', { longest: 0 }]), 1), S = play(layerOf(drift), 1);
    for (let i = 0; i < S.buf.length; i++) assert.ok(Math.abs(D.buf[i] - S.buf[i]) < 1e-6, `channel ${i}`);
  });

  test('played at 60 fps it shows what it shows at 40', () => {
    const [a, b] = [40, 60].map((fps) => play(layerOf(drift, ['delay', { longest: 2, direction: 'up' }]), 3, fps));
    let worst = 0;
    for (let i = 0; i < a.buf.length; i++) worst = Math.max(worst, Math.abs(a.buf[i] - b.buf[i]));
    assert.ok(worst < 0.02, `worst ${worst}`);
  });

  test('Steps snaps the lateness into blocks; Bounce makes the top as early as the bottom', () => {
    const L = layerOf(flash, ['delay', { direction: 'up', longest: 1, bounce: 1 }]);
    const [lo, mid, hi] = ends(L);
    play(L, 1.025);
    assert.ok(alpha(L, lo) > 0.5 && alpha(L, hi) > 0.5 && !(alpha(L, mid) > 0.5));
    const S = play(layerOf(flash, ['delay', { direction: 'up', longest: 1, steps: 2 }]), 1.525);
    assert.ok(S.idx.some((_, j) => alpha(S, j) > 0.5));
    for (let j = 0; j < S.idx.length; j++) if (alpha(S, j) > 0.5) assert.ok(Math.abs(S.ly[j] - 0.5) <= 0.25 + 1e-9);
  });

  test('time going back starts it again, and a reading before it holds anything gets the oldest frame', () => {
    const L = play(layerOf(flash, ['delay', { longest: 1 }]), 1.5);
    at(L, 1.02);
    assert.ok(L.idx.every((_, j) => alpha(L, j) > 0.5), 'all of it shows the one frame it has: the flash');
    at(L, 1.2);
    assert.ok(L.idx.some((_, j) => alpha(L, j) > 0.5), 'the oldest frame, the flash, still shows high up');
  });
});

describe('history', () => {
  test('it is declared by a filter whose stage is history, in seconds up to 8', () => {
    const body = 'function filter(c) { return past(0.5); }';
    assert.ok(compileModule(`const stage = 'history';\nconst history = 2;\n${body}`, 'filter').history);
    for (const bad of [`const history = 2;\n${body}`, `const stage = 'history';\nconst history = 9;\n${body}`,
      `const stage = 'history';\nconst history = '2';\n${body}`]) {
      assert.throws(() => compileModule(bad, 'filter'), /history must be seconds/);
    }
    const none = compileModule(`const stage = 'history';\n${body}`, 'filter');
    assert.throws(() => none.filter([0, 0, 0, 0]), /past\(\) needs `const history/);
  });
});
