// A clip's transition (SPEC "Timeline": fade or wipe), the timeline's edits keeping it, and speeds in beats
// (SPEC-library "Param bindings": { mod: 'beats' }) through the core, the dialog and a bake's key.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { Layers } from '../shared/schemas/look.ts';
import {
  compileLayer, normalizeClips, prepareLayer, prepareLook, prepareScene, renderFrame, transitionWeight,
} from '../public/js/pattern-core.ts';
import { bindingForm, bindingText, makeBinding } from '../public/js/ui/bindings.ts';
import { editClip, fitClip, moveClip, setTransition, transitionKey } from '../public/js/ui/timeline-model.ts';
import { renderFields } from '../src/bake.ts';
import { cog } from './fixtures/rigs.js';

const scene = prepareScene(cog);
const WHITE = 'function pixel() { return [1, 1, 1]; }';

describe('transitionWeight', () => {
  const at = (lz) => ({ lx: 0.5, ly: 0.5, lz, a: 0, r: 0, u: 0 });
  test('a fade leaves every pixel whole (the level carries it)', () => {
    assert.equal(transitionWeight('fade', 'right', 0.3, at(0.9)), 1);
  });
  test('a wipe lights across its direction as the envelope rises, and goes out the way it came', () => {
    assert.deepEqual([0.2, 0.8].map((x) => transitionWeight('wipe', 'right', 0.5, at(x), false, 0.01)), [1, 0]);
    assert.deepEqual([0.2, 0.8].map((x) => transitionWeight('wipe', 'right', 0.5, at(x), true, 0.01)), [0, 1]);
    assert.deepEqual([0.2, 0.8].map((x) => transitionWeight('wipe', 'left', 0.5, at(x), false, 0.01)), [0, 1]);
    assert.equal(transitionWeight('wipe', 'right', 0, at(0), false, 0.1), 0, 'nothing at 0');
    assert.equal(transitionWeight('wipe', 'right', 1, at(1), false, 0.1), 1, 'everything at 1');
  });
});

describe('a clip\'s transition in a frame', () => {
  function frame(clip, t) {
    const layer = { id: 'l', clips: [clip], modules: [{ id: 's', kind: 'source', code: WHITE }] };
    const L = prepareLayer(scene, layer, compileLayer(layer)), { rgb } = renderFrame(scene, [L], t);
    return Array.from(L.idx, (k, j) => ({ lz: L.lz[j], v: rgb[3 * k] }));
  }
  const clip = { start: 0, end: 10, fadeIn: 2, fadeOut: 2 };
  const wipe = { ...clip, transition: { kind: 'wipe', direction: 'right', softness: 0.01 } };

  test('a fade dims the whole layer', () => {
    assert.ok(frame(clip, 1).every(({ v }) => Math.abs(v - 0.5) < 1e-6));
  });
  test('a wipe lights the near side at full level and leaves the far side dark, in and out', () => {
    const half = (px, lit) => px.filter(({ lz }) => Math.abs(lz - 0.5) > 0.02)
      .every(({ lz, v }) => v === ((lz < 0.5) === lit ? 1 : 0));
    assert.ok(half(frame(wipe, 1), true), 'fading in: the left lit');
    assert.ok(half(frame(wipe, 9), false), 'fading out: the left gone first');
    assert.ok(frame(wipe, 5).every(({ v }) => v === 1), 'between the fades: all of it');
  });
  test('an unequal wipe goes out the way it came from the start of its fade-out, not the clip\'s middle', () => {
    const long = { ...wipe, fadeIn: 1, fadeOut: 8 };   // fade-out from t=2
    const half = (px, lit) => px.filter(({ lz }) => Math.abs(lz - 0.5) > 0.02)
      .every(({ lz, v }) => v === ((lz < 0.5) === lit ? 1 : 0));
    assert.ok(half(frame(long, 6), false), 'past the middle: the left gone first');
    const before = frame(long, 4.99), after = frame(long, 5.01);
    const jumped = before.filter(({ v }, i) => Math.abs(v - after[i].v) > 0.5).length;
    assert.ok(jumped < before.length / 20, `no jump at the middle (${jumped} of ${before.length})`);
  });
  test('kept by normalizeClips and the look schema; an unknown kind fades', () => {
    assert.deepEqual(normalizeClips([wipe])[0].transition, wipe.transition);
    assert.equal(normalizeClips([{ ...clip, transition: { kind: 'spin' } }])[0].transition, undefined);
    const look = (transition) => Layers.safeParse([{ id: 'a', code: WHITE, clips: [{ ...clip, transition }] }]);
    assert.ok(look({ kind: 'wipe', direction: 'up' }).success);
    assert.ok(!look({ kind: 'wipe', direction: 'sideways' }).success);
  });
});

test('the timeline\'s edits keep a clip\'s transition, and set it', () => {
  const clips = [fitClip({ start: 0, end: 4, fadeIn: 1, fadeOut: 1 })];
  const wiped = setTransition(clips, 0, 'wipe:up');
  assert.deepEqual(wiped[0].transition, { kind: 'wipe', direction: 'up' });
  assert.equal(transitionKey(wiped[0]), 'wipe:up');
  assert.deepEqual(editClip(wiped, 0, { fadeIn: 2 })[0].transition, { kind: 'wipe', direction: 'up' });
  assert.deepEqual(moveClip(wiped, 0, 3)[0].transition, { kind: 'wipe', direction: 'up' });
  assert.equal(setTransition(wiped, 0, 'fade')[0].transition, undefined);
});

describe('speeds in beats', () => {
  const code = `const params = { speed: { value: 1, min: 0, max: 10, label: 'Speed' } };
function pixel(p, t, P) { return [P.speed / 10, 0, 0]; }`;
  const value = (binding, bpm) => {
    const layer = { id: 'l', modules: [{ id: 's', kind: 'source', code, params: { speed: binding } }] };
    const L = prepareLayer(scene, layer, compileLayer(layer));
    return renderFrame(scene, [L], 1, null, prepareLook({ bpm })).rgb[3 * L.idx[0]] * 10;
  };
  test('per × the tempo, held to the param\'s range; 120 with none', () => {
    assert.ok(Math.abs(value({ mod: 'beats', per: 1 }, 90) - 1.5) < 1e-5);
    assert.ok(Math.abs(value({ mod: 'beats' }, undefined) - 2) < 1e-5);
    assert.equal(Math.round(value({ mod: 'beats', per: 8 }, 120)), 10);
  });
  test("a speed a minute (unit: 'minute') counts per × the tempo", () => {
    const code = `const params = { often: { value: 1, min: 0, max: 1000, unit: 'minute' } };
function pixel(p, t, P) { return [P.often / 1000, 0, 0]; }`;
    const often = { mod: 'beats', per: 2 }, layer = { id: 'l', modules: [{ id: 's', kind: 'source', code,
      params: { often } }] };
    const L = prepareLayer(scene, layer, compileLayer(layer));
    assert.ok(Math.abs(renderFrame(scene, [L], 1, null, prepareLook({ bpm: 90 })).rgb[3 * L.idx[0]] - 0.18) < 1e-5);
  });
  test('the dialog makes and names it', () => {
    const p = { kind: 'number', value: 1, label: 'Speed', min: 0, max: 10, step: 0.1, options: [] };
    const f = { ...bindingForm({}, p, ['energy']), mod: 'beats', per: '0.5' };
    assert.deepEqual(makeBinding(f, p), { mod: 'beats', per: 0.5 });
    assert.equal(bindingText({ mod: 'beats', per: 0.5 }), '♩ 0.5 a beat');
  });
  test('a bake\'s key holds the tempo when a param counts beats', () => {
    const look = (speed) => ({ bpm: 90, layers: [{ id: 'a', modules: [{ id: 's', code, params: { speed } }] }] });
    assert.equal(renderFields(look({ mod: 'beats' })).bpm, 90);
    assert.ok(Array.isArray(renderFields(look(2))), 'a plain speed: the layers alone');
  });
});
