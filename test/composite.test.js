// Composites (SPEC-library "Composites"): sub-layers, each its own chain, blended into one source of the chain round
// them, so a warp or filter below the composite works on all of it and one inside a sub-layer on that alone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import { compileLayer, prepareLayer, prepareScene, renderFrame } from '../public/js/pattern-core.ts';

const rig = JSON.parse(readFileSync(new URL('../public/data/rig.json', import.meta.url), 'utf8'));
const lib = (name) => readFileSync(new URL(`../public/patterns/${name}.js`, import.meta.url), 'utf8');
const scene = prepareScene(rig);
const layerOf = (layer) => prepareLayer(scene, layer, compileLayer(layer));
const rgbOf = (layer, t = 0.5) => renderFrame(scene, [layerOf(layer)], t).rgb.slice();
const RED = { id: 'r', kind: 'source', code: 'function pixel(p) { return [p.lz, 0, 0, 0.5 + p.ly / 2]; }' };
const BLUE = { id: 'b', kind: 'source', code: 'function pixel(p) { return [0, 0, p.ly, p.lz]; }' };
const FLIP = { id: 'w', kind: 'warp', code: 'function warp(q) { move(q, 1 - q.lx, q.ly, 1 - q.lz); }' };
const DARK = { id: 'd', kind: 'filter', code: 'function filter(c) { c[3] = 0; return c; }' };
const comp = (layers, more = {}) => ({ id: 'c', kind: 'composite', title: 'Composite', code: '', params: {},
  layers: layers.map((modules, i) => ({ id: `s${i}`, title: `Sub ${i}`, modules })), ...more });

describe('a composite', () => {
  test('a warp below it bends every sub-layer, as below two sources', () => {
    const flat = rgbOf({ id: 'l', modules: [RED, BLUE, FLIP] });
    assert.deepEqual(rgbOf({ id: 'l', modules: [comp([[RED], [BLUE]]), FLIP] }), flat);
    assert.notDeepEqual(rgbOf({ id: 'l', modules: [comp([[RED], [BLUE]])] }), flat);
  });

  test('a filter in a sub-layer works on that sub-layer alone; below the composite, on all of it', () => {
    const red = rgbOf({ id: 'l', modules: [RED] });
    assert.deepEqual(rgbOf({ id: 'l', modules: [comp([[RED]])] }), red);
    const top = { ...BLUE, id: 't' };
    assert.deepEqual(rgbOf({ id: 'l', modules: [comp([[RED]]), top] }), rgbOf({ id: 'l', modules: [RED, top] }));
    assert.deepEqual(rgbOf({ id: 'l', modules: [comp([[RED], [BLUE, DARK]])] }), red);
    assert.ok(rgbOf({ id: 'l', modules: [comp([[RED], [BLUE]]), DARK] }).every((v) => v === 0));
  });

  test('a sub-layer plays only on its groups, at the real LED, a warp below or not', () => {
    const g = rig.groups.find((x) => x.parent != null && x.tags?.length) ?? rig.groups[1];
    const whole = rgbOf({ id: 'l', modules: [RED] });
    const part = rgbOf({ id: 'l', modules: [{ ...comp([]), layers: [
      { id: 's0', title: 'Part', groups: [g.id], modules: [RED] }] }] });
    const inside = new Set(layerOf({ id: 'p', groups: [g.id], modules: [RED] }).idx);
    for (let k = 0; k < scene.count; k++) {
      assert.equal(part[3 * k], inside.has(k) ? whole[3 * k] : 0, `LED ${k}`);
    }
    const bent = rgbOf({ id: 'l', modules: [{ ...comp([]), layers: [
      { id: 's0', title: 'Part', groups: [g.id], modules: [RED] }] }, FLIP] });
    for (let k = 0; k < scene.count; k++) if (!inside.has(k)) assert.equal(bent[3 * k], 0, `LED ${k}, bent`);
  });

  test('nests two deep, and holds no stage end', () => {
    const deep = comp([[comp([[comp([[RED]], { id: 'c3' })]], { id: 'c2' })]]);
    assert.throws(() => layerOf({ id: 'l', modules: [deep] }), /nest 2 deep/);
    const blur = { id: 'x', kind: 'filter', ref: 'blur', code: lib('blur') };
    assert.throws(() => layerOf({ id: 'l', modules: [comp([[RED, blur]])] }), /cannot go in a composite/);
  });

  test('a sub-layer switched off is not compiled: its broken code does not stop the composite', () => {
    const broken = { id: 'x', kind: 'source', code: 'function pixel( {' };
    const look = { id: 'l', modules: [{ ...comp([[RED]]), layers: [{ id: 's0', title: 'On', modules: [RED] },
      { id: 's1', title: 'Off', enabled: false, modules: [broken] }] }] };
    assert.deepEqual(rgbOf(look), rgbOf({ id: 'l', modules: [RED] }));
  });

  test('a sub-layer\'s explicit blend leaves the next one\'s default alone', () => {
    const solid = (id, c) => ({ id, kind: 'source', code: `function pixel() { return [${c}, 1]; }` });
    const sub = (id, blend) => ({ id, title: id, ...(blend ? { blend } : {}), modules: [solid(id, id === 'r' ? '1, 0, 0'
      : '0, 0, 1')] });
    const rgb = (first) => rgbOf({ id: 'l', modules: [{ ...comp([]), layers: [sub('r', first), sub('b')] }] });
    assert.deepEqual(Array.from(rgb().slice(0, 3)), [1, 0, 1], 'over, then add');
    assert.deepEqual(Array.from(rgb('over').slice(0, 3)), [1, 0, 1], 'the first saying over changes nothing');
  });

  test('a module failing inside it is named, not the composite', () => {
    const bad = { id: 'bad', kind: 'source', title: 'Bad', code: 'function pixel() { return NaN; }' };
    const L = layerOf({ id: 'l', modules: [comp([[RED], [bad]])] });
    const { errors } = renderFrame(scene, [L], 0);
    assert.equal(errors[0].module, 'bad');
  });
});
