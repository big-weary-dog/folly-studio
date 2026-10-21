// What a live engine (the Pi, SPEC-pi) moves in place on a prepared look: the downbeat (beat0) that beat() and
// LFOs in beats count from, and the static globals and macros that bound params read; and globals.live, the controls
// a look offers. Bakes never move them, so they render as before (rig-folly.test.js holds their bytes).
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { compileLayer, prepareLayer, prepareLook, prepareScene, renderFrame } from '../public/js/pattern-core.ts';
import { Globals } from '../shared/schemas/look.ts';
import { mini } from './fixtures/rigs.js';

const scene = prepareScene(mini);
const out = new Float32Array(scene.count * 3);
const first = (code, params, look, t) => {
  const layer = { id: 'l', modules: [{ id: 'm', code, params }] };
  renderFrame(scene, [prepareLayer(scene, layer, compileLayer(layer))], t, out, look);
  return out[0];
};

describe('the downbeat', () => {
  const BEAT = 'function pixel(p, t, P, G) { return beat(t, G.bpm); }';
  test('beat() counts from beat0, 0 by default', () => {
    const L = prepareLook({ bpm: 120 });
    assert.equal(L.beat0, 0);
    assert.ok(Math.abs(first(BEAT, {}, L, 1.25) - 0.5) < 1e-6);
    L.beat0 = 1.25;
    assert.ok(first(BEAT, {}, L, 1.25) < 1e-6, 'a tap at 1.25 s is the downbeat');
    assert.ok(Math.abs(first(BEAT, {}, L, 1.5) - 0.5) < 1e-6);
  });

  test('an LFO in beats counts from it; one in seconds does not', () => {
    const LFO = `const params = { v: { value: 0.5, min: 0, max: 1 } };
      function pixel(p, t, P) { return P.v; }`;
    const lfo = (unit) => ({ v: { mod: 'lfo', shape: 'saw', rate: 1, unit, center: 0.5, depth: 0.5 } });
    const L = prepareLook({ bpm: 60 });
    const before = [first(LFO, lfo('beats'), L, 2.25), first(LFO, lfo('seconds'), L, 2.25)];
    L.beat0 = 0.25;
    assert.ok(Math.abs(first(LFO, lfo('beats'), L, 2.25) - 0) < 1e-6, 'on the downbeat, a saw starts');
    assert.notEqual(first(LFO, lfo('beats'), L, 2.25), before[0]);
    assert.equal(first(LFO, lfo('seconds'), L, 2.25), before[1]);
  });
});

test('a macro set in place reaches params bound to it, with no lane', () => {
  const CODE = `const params = { v: { value: 0, min: 0, max: 1 } };
    function pixel(p, t, P) { return P.v; }`;
  const bound = { v: { mod: 'global', name: 'storm', from: 0, to: 1 } };
  const L = prepareLook({ globals: { macros: { storm: { value: 0.2, min: 0, max: 1 } } } });
  assert.ok(Math.abs(first(CODE, bound, L, 1) - 0.2) < 1e-6);
  L.g.macros[0].value = 0.7;
  assert.ok(Math.abs(first(CODE, bound, L, 1.025) - 0.7) < 1e-6);
  assert.ok(Math.abs(L.normAt('storm', 1) - 0.7) < 1e-9, 'normAt reads it too (integrated clocks)');
});

describe('globals.live', () => {
  const macros = { storm: { value: 0.2, min: 0, max: 1 } };
  test('the look\'s macros and bpm, each once; an old look\'s globals are dropped', () => {
    assert.deepEqual(Globals.parse({ macros, live: ['storm', 'level', 'bpm'] }).live, ['storm', 'bpm']);
    assert.deepEqual(Globals.parse({ energy: 0.4, live: ['energy', 'speed'] }).live, ['energy']);
    assert.equal(Globals.parse({ macros }).live, undefined);
  });
  for (const live of [['rain'], ['toString'], ['storm', 'storm'], ['palette'], 'storm', [3]]) {
    test(`refuses ${JSON.stringify(live)}`, () => {
      assert.equal(Globals.safeParse({ macros, live }).success, false);
    });
  }
});
