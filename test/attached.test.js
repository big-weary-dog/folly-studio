// Attached modules (SPEC-library "Attached modules"): a warp or filter `on` a source works on that source alone, as a
// composite of one sub-layer would; one holding real LED colours (blur, trails) runs over the source by itself.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import { compileLayer, prepareLayer, prepareScene, renderFrame } from '../public/js/pattern-core.ts';
import { Modules } from '../shared/schemas/look.ts';

const rig = JSON.parse(readFileSync(new URL('../public/data/rig.json', import.meta.url), 'utf8'));
const lib = (name) => readFileSync(new URL(`../public/patterns/${name}.js`, import.meta.url), 'utf8');
const scene = prepareScene(rig);
const layerOf = (modules) => prepareLayer(scene, { id: 'l', modules }, compileLayer({ id: 'l', modules }));
const rgbOf = (modules, t = 0.5) => renderFrame(scene, [layerOf(modules)], t).rgb.slice();
const RED = { id: 'r', kind: 'source', code: 'function pixel(p) { return [p.lz, 0, 0, 0.5 + p.ly / 2]; }' };
const BLUE = { id: 'b', kind: 'source', code: 'function pixel(p) { return [0, 0, p.ly, p.lz]; }' };
const FLIP = { id: 'w', kind: 'warp', code: 'function warp(q) { move(q, 1 - q.lx, q.ly, 1 - q.lz); }' };
const DARK = { id: 'd', kind: 'filter', code: 'function filter(c) { c[3] = 0; return c; }' };
const BLUR = { id: 'x', kind: 'filter', ref: 'blur', code: lib('blur'), params: { radius: 0.6 } };
const comp = (modules) => ({ id: 'c', kind: 'composite', title: 'Composite', code: '', params: {},
  layers: [{ id: 's0', title: 'Sub', modules }] });
const on = (m, id = 'r') => ({ ...m, on: id });

describe('an attached module', () => {
  test('a warp bends its source alone, as in a composite of one sub-layer', () => {
    const attached = rgbOf([RED, on(FLIP), BLUE]);
    assert.deepEqual(attached, rgbOf([comp([RED, FLIP]), BLUE]));
    assert.notDeepEqual(attached, rgbOf([RED, BLUE, FLIP]));
    assert.notDeepEqual(attached, rgbOf([RED, BLUE]));
  });

  test('a filter works on its source\'s output alone, before it joins the chain', () => {
    assert.deepEqual(rgbOf([RED, on(DARK), BLUE]), rgbOf([BLUE]));
    assert.ok(rgbOf([RED, BLUE, DARK]).every((v) => v === 0));
  });

  test('off, or on a source that is off, it does nothing', () => {
    assert.deepEqual(rgbOf([RED, on({ ...DARK, enabled: false }), BLUE]), rgbOf([RED, BLUE]));
    assert.deepEqual(rgbOf([{ ...RED, enabled: false }, on(DARK), BLUE]), rgbOf([BLUE]));
  });

  test('the source keeps how it combines, and a filter\'s input reads it as attached', () => {
    const top = { ...BLUE, blend: 'multiply' };
    assert.deepEqual(rgbOf([RED, on(FLIP), top]), rgbOf([comp([RED, FLIP]), top]));
    const hidden = { ...RED, as: 'input' };
    const mask = { id: 'k', kind: 'filter', ref: 'mask', code: lib('mask'), input: 'r' };
    assert.deepEqual(rgbOf([hidden, on(FLIP), BLUE, mask]), rgbOf([{ ...comp([RED, FLIP]), id: 'r', as: 'input' },
      BLUE, mask]));
  });

  test('its filter may read an earlier source of the chain round it', () => {
    const mask = { id: 'k', kind: 'filter', ref: 'mask', code: lib('mask'), input: 'b' };
    const hidden = { ...BLUE, as: 'input' };
    assert.notDeepEqual(rgbOf([hidden, RED, on(mask)]), rgbOf([hidden, RED]));
    assert.deepEqual(rgbOf([hidden, RED, on(mask)]), rgbOf([hidden, RED, mask]));
  });

  test('a blur blurs its source alone, which warps below pass by', () => {
    assert.deepEqual(rgbOf([RED, on(BLUR)]), rgbOf([RED, BLUR]));
    assert.deepEqual(rgbOf([RED, on(BLUR), FLIP]), rgbOf([RED, BLUR]));
    const both = rgbOf([RED, on(BLUR), BLUE, FLIP]), flat = rgbOf([RED, BLUE, FLIP]);
    assert.notDeepEqual(both, flat);
    // BLUE, bent: where RED adds nothing, the blue channel is the flipped BLUE's either way.
    assert.deepEqual(rgbOf([{ ...RED, enabled: false }, on(BLUR), BLUE, FLIP]), rgbOf([BLUE, FLIP]));
  });

  test('trails keep its source\'s frames alone', () => {
    const trails = { id: 't', kind: 'filter', ref: 'trails', code: lib('trails') };
    const run = (modules) => {
      const L = layerOf(modules);
      return [0, 0.1, 0.2, 0.3].map((t) => renderFrame(scene, [L], t).rgb.slice()).at(-1);
    };
    assert.deepEqual(run([RED, on(trails), FLIP]), run([RED, trails]));
  });

  test('a stage end attached cannot go in a composite; a spatial run reads no input', () => {
    assert.throws(() => layerOf([comp([RED, on(BLUR)])]), /cannot go in a composite/);
    const mask = { id: 'k', kind: 'filter', ref: 'mask', code: lib('mask'), input: 'b' };
    assert.throws(() => layerOf([{ ...BLUE, as: 'input' }, RED, on(mask), on(BLUR)]), /reads no input/);
  });

  test('a failing attached module is named', () => {
    const bad = { id: 'bad', kind: 'filter', code: 'function filter() { return NaN; }', on: 'r' };
    assert.equal(renderFrame(scene, [layerOf([RED, bad])], 0).errors[0].module, 'bad');
  });
});

describe('on, in a look', () => {
  const ok = (list) => Modules.safeParse(list).success;
  test('names the source or composite just above its run', () => {
    assert.ok(ok([RED, on(FLIP), on(DARK), BLUE]));
    assert.ok(ok([comp([RED]), on(FLIP, 'c')]));
    assert.ok(!ok([RED, BLUE, on(FLIP)]));
    assert.ok(!ok([RED, FLIP, on(DARK)]));
    assert.ok(!ok([RED, on(BLUE)]));
  });
});
