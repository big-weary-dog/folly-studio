// Integrated clocks (SPEC "Integrated clocks"): clock(name) is a speed param's distance, a fixed one its value × the
// look's clock, a bound one summed on a grid from 0, so a modulated speed never jumps and played equals sought to the
// bit; the LFO's hold shape; a bake's key holds the tempo for code that reads G.bpm.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import {
  compileLayer, layerEnvelope, prepareLayer, prepareLook, prepareScene, renderFrame,
} from '../public/js/pattern-core.ts';
import { renderFields } from '../src/bake.ts';
import { mini } from './fixtures/rigs.js';

const scene = prepareScene(mini);
// The first LED says the clock, the speed and the tempo, each scaled into 0..1.
const CLOCK = `const params = { speed: { value: 0.5, min: -4, max: 4 } };
function pixel(p, t, P, G) { return [0.5 + clock('speed') / 64, P.speed / 8 + 0.5, G.bpm / 1000]; }`;
const layerOf = (params, extra = {}) => {
  const layer = { id: 'l', modules: [{ id: 'm', code: CLOCK, params }], ...extra };
  return prepareLayer(scene, layer, compileLayer(layer));
};
/** What the first LED says at show time t, its layer's clip envelope undone. */
const out = new Float32Array(scene.count * 3);
const read = (L, t, look) => {
  renderFrame(scene, [L], t, out, look);
  const env = L.clips ? layerEnvelope(L.clips, t) : 1, [r, g, b] = [0, 1, 2].map((i) => out[i] / env);
  return { clock: (r - 0.5) * 64, speed: (g - 0.5) * 8, bpm: b * 1000, env, raw: out[0] };
};

describe('clock(name)', () => {
  test('a fixed speed: its value × the look\'s clock (the global speed too)', () => {
    const L = layerOf({ speed: 1.5 });
    assert.ok(Math.abs(read(L, 2, prepareLook(null)).clock - 3) < 1e-4);
    assert.ok(Math.abs(read(layerOf({ speed: 1.5 }), 2, prepareLook({ globals: { speed: 2 } })).clock - 6) < 1e-4);
  });

  const BOUND = {
    'an LFO': { speed: { mod: 'lfo', shape: 'sine', rate: 0.7, center: 1, depth: 2 } },
    'a global with a lane': { speed: { mod: 'global', name: 'energy', from: -1, to: 3 } },
    'the clip envelope': { speed: { mod: 'envelope', from: 0, to: 2 } },
  };
  const look = () => prepareLook({ automation: { energy: [[0, 0], [3, 1], [6, 0.2]], speed: [[0, 1], [5, 2]] } });
  const clips = [{ start: 0.5, end: 9, fadeIn: 1.5, fadeOut: 2 }];

  for (const [what, params] of Object.entries(BOUND)) {
    test(`bound to ${what}: never jumps, and played equals sought, to the bit`, () => {
      const played = layerOf(params, { clips }), L = look();
      const frames = [];
      for (let f = 0; f <= 320; f++) frames.push(read(played, f / 40, L));
      for (let f = 1; f < frames.length; f++) {
        if (frames[f].env < 0.2 || frames[f - 1].env < 0.2) continue;
        const step = Math.abs(frames[f].clock - frames[f - 1].clock);
        assert.ok(step <= 3 * 2 / 40 + 1e-3, `${what}: frame ${f} moved ${step}, past the fastest speed's step`);
      }
      assert.ok(Math.abs(frames[300].clock - frames[100].clock) > 0.5, 'it moved');
      for (const t of [8, 3.3, 0.625, 7.9]) {
        const sought = read(layerOf(params, { clips }), t, look()).raw;
        assert.equal(read(played, t, L).raw, sought, `t = ${t}: played and sought`);
      }
    });
  }
});

describe('the hold LFO', () => {
  test('eases up from the bottom, holds at the top, eases down, holds at the bottom', () => {
    const L = layerOf({ speed: { mod: 'lfo', shape: 'hold', rate: 0.25, center: 0, depth: 2, hold: 0.5 } });
    const look = prepareLook(null), at = (t) => read(L, t, look).speed;
    // A 4 s cycle: up over 1 s, held 1 s, down over 1 s, held 1 s.
    assert.ok(Math.abs(at(0) + 2) < 1e-3 && Math.abs(at(0.5)) < 1e-3, 'rising through the middle');
    for (const t of [1.1, 1.5, 1.95]) assert.ok(Math.abs(at(t) - 2) < 1e-3, `held at the top at ${t}`);
    assert.ok(Math.abs(at(2.5)) < 1e-3, 'falling through the middle');
    for (const t of [3.1, 3.5, 3.95]) assert.ok(Math.abs(at(t) + 2) < 1e-3, `held at the bottom at ${t}`);
    let worst = 0;
    for (let f = 1; f <= 400; f++) worst = Math.max(worst, Math.abs(at(f / 100) - at((f - 1) / 100)));
    assert.ok(worst < 0.07, `no cut: ${worst}`);
  });
});

describe('the tempo', () => {
  test('a bake\'s key holds the tempo when code reads it', () => {
    const plain = { layers: [{ code: 'function pixel() { return 1; }' }], bpm: 90 };
    assert.ok(Array.isArray(renderFields(plain)), 'no tempo: the plain layers, as before');
    const reads = { layers: [{ modules: [{ code: 'function pixel(p, t, P, G) { return beat(t, G.bpm); }' }] }],
      bpm: 90 };
    assert.equal(renderFields(reads).bpm, 90);
  });
});
