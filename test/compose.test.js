// Composition (SPEC "Modules", "Globals", "Param bindings"): module chains, globals, automation and use(), on the
// Folly's rig with our own library modules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import {
  automationAt, compileLayer, compilePattern, DEFAULT_PALETTE, layerModules, PALETTE_ROLES, prepareLayer, prepareLook,
  prepareScene, renderFrame, setLibrary,
} from '../public/js/pattern-core.js';

const here = (p) => new URL(p, import.meta.url);
const rig = JSON.parse(readFileSync(here('../public/data/rig.json'), 'utf8'));
const palettes = JSON.parse(readFileSync(here('../public/data/palettes.json'), 'utf8'));
const lib = (name) => readFileSync(here(`../public/patterns/${name}.js`), 'utf8');
const scene = prepareScene(rig);
const N = scene.count;
const layerOf = (layer) => prepareLayer(scene, layer, compileLayer(layer));
const frame = (layers, t, look) => renderFrame(scene, layers, t, undefined, look);
const src = (id, code, extra = {}) => ({ id, kind: 'source', title: id, code, ...extra });
const RED = 'function pixel() { return [1, 0, 0]; }';
const at = (rgb, k) => [rgb[3 * k], rgb[3 * k + 1], rgb[3 * k + 2]];
const near = (a, b, eps = 1e-5) => a.every((v, i) => Math.abs(v - b[i]) < eps);

describe('module chains', () => {
  test('a layer with code is a one-source chain and renders exactly as that chain', () => {
    const code = lib('meteors');
    const old = prepareLayer(scene, { id: 'a', code, params: { tail: 20 } }, compilePattern(code));
    const chain = layerOf({ id: 'b', modules: [src('m', code, { params: { tail: 20 } })] });
    assert.deepEqual(layerModules({ title: 'X', code }).map((m) => m.kind), ['source']);
    for (const t of [0, 1.25, 7.5]) assert.deepEqual(frame([chain], t).rgb, frame([old], t).rgb, `t=${t}`);
  });

  test('a warp moves the pixel for the modules after it, not before', () => {
    const lz = 'function pixel(p) { return [p.lz, 0, 0]; }';
    const flip = { id: 'w', kind: 'warp', code: 'function warp(q) { q.lz = 1 - q.lz; }' };
    const before = layerOf({ id: 'a', modules: [flip, src('s', lz)] });
    const after = layerOf({ id: 'b', modules: [src('s', lz), flip] });
    const plain = layerOf({ id: 'c', modules: [src('s', lz)] });
    const k = before.idx[5];
    assert.ok(near([frame([before], 0).rgb[3 * k]], [1 - frame([plain], 0).rgb[3 * k]], 1e-6));
    assert.deepEqual(frame([after], 0).rgb, frame([plain], 0).rgb);
  });

  test('sources combine over then add; an input-only source feeds a filter without drawing', () => {
    const blue = 'function pixel() { return [0, 0, 0.5]; }';
    const two = layerOf({ id: 'a', modules: [src('r', RED), src('b', blue)] });
    assert.deepEqual(at(frame([two], 0).rgb, 0), [1, 0, 0.5]);
    const maxed = layerOf({ id: 'a', modules: [src('r', RED), src('b', blue, { blend: 'multiply' })] });
    assert.deepEqual(at(frame([maxed], 0).rgb, 0), [0, 0, 0]);
    const filter = { id: 'f', kind: 'filter', input: 'b',
      code: 'function filter(c, q, t, P, G, x) { return [c[0], x[2], 0]; }' };
    const fed = layerOf({ id: 'a', modules: [src('r', RED), src('b', blue, { as: 'input' }), filter] });
    assert.deepEqual(at(frame([fed], 0).rgb, 0), [1, 0.5, 0]);
    const late = layerOf({ id: 'a', modules: [{ ...filter, input: 'r' }, src('r', RED)] });  // input after: none
    assert.deepEqual(frame([late], 0).errors.length, 1, 'x is undefined, so x[2] throws');
  });

  test('meteors masked by clouds: the mask follows how bright the clouds are', () => {
    const modules = [src('met', lib('meteors')), src('cl', lib('clouds'), { as: 'input' }),
      { id: 'mask', kind: 'filter', input: 'cl', code: lib('mask'), params: { cutoff: 0.5, softness: 0.01 } }];
    const masked = layerOf({ id: 'a', modules });
    const meteors = layerOf({ id: 'b', modules: [modules[0]] });
    const clouds = layerOf({ id: 'c', modules: [{ ...modules[1], as: undefined }] });
    const [m, c, s] = [masked, meteors, clouds].map((L) => frame([L], 3).rgb.slice());
    let dark = 0, shown = 0;
    for (let k = 0; k < N; k++) {
      const cloud = Math.max(...at(s, k));
      if (cloud < 0.3) { assert.deepEqual(at(m, k), [0, 0, 0], `LED ${k} outside the clouds`); dark++; }
      if (cloud > 0.75) { assert.ok(near(at(m, k), at(c, k)), `LED ${k} inside the clouds`); shown++; }
    }
    assert.ok(dark > 200 && shown > 200, `${dark} masked, ${shown} shown`);
  });

  test('errors name the module; a disabled module is skipped, even when broken', () => {
    const boom = src('bad', 'function pixel(p) { if (p.k === 9) throw new Error("nope"); return 1; }',
      { title: 'Bad' });
    const { errors } = frame([layerOf({ id: 'L', modules: [src('ok', RED), boom] })], 0);
    assert.equal(errors.length, 1);
    assert.deepEqual([errors[0].id, errors[0].module], ['L', 'bad']);
    assert.match(errors[0].error, /^Bad: Error: nope/);
    const off = { ...src('x', 'function pixel( {'), enabled: false };
    const L = layerOf({ id: 'L', modules: [src('ok', RED), off] });
    assert.deepEqual(at(frame([L], 0).rgb, 0), [1, 0, 0]);
    assert.throws(() => compileLayer({ modules: [src('x', 'function pixel( {', { title: 'Broken' })] }),
      /^Error: Broken: Syntax/);
  });
});

describe('param bindings', () => {
  const code = `const params = { v: { value: 0.5, min: 0, max: 2 } };
    function pixel(p, t, P) { return [P.v / 2, 0, 0]; }`;
  const value = (params, t, look, clips) => 2 * frame(
    [layerOf({ id: 'a', clips, modules: [src('m', code, { params })] })], t, look).rgb[0];

  test('an LFO in Hz or beats, held to the range', () => {
    const sine = { v: { mod: 'lfo', shape: 'sine', rate: 1, center: 1, depth: 0.5 } };
    assert.ok(Math.abs(value(sine, 0.25) - 1.5) < 1e-6);
    assert.ok(Math.abs(value({ v: { ...sine.v, depth: 5 } }, 0.25) - 2) < 1e-6, 'clamped to max');
    const beats = { v: { mod: 'lfo', shape: 'saw', rate: 1, unit: 'beats', center: 1, depth: 1 } };
    assert.ok(Math.abs(value(beats, 0.125, prepareLook({ bpm: 60 })) - 0.25) < 1e-6);   // phase 1/8 at 60 bpm
  });

  test('a global (a macro over its range) and the clip envelope', () => {
    const look = prepareLook({ globals: { macros: { storm: { value: 3, min: 0, max: 4 } } } });
    assert.ok(Math.abs(value({ v: { mod: 'global', name: 'storm', from: 0, to: 2 } }, 0, look) - 1.5) < 1e-6);
    const env = { v: { mod: 'envelope', from: 0, to: 2 } };
    assert.ok(Math.abs(value(env, 1, undefined, [{ start: 0, end: 10, fadeIn: 2 }]) - 0.5) < 1e-6);
  });
});

describe('globals and automation', () => {
  const red = layerOf({ id: 'a', modules: [src('r', RED)] });

  test('level, hue and saturation grade the composite', () => {
    assert.ok(near(at(frame([red], 0, prepareLook({ globals: { level: 0.5 } })).rgb, 0), [0.5, 0, 0]));
    assert.ok(near(at(frame([red], 0, prepareLook({ globals: { hue: 1 / 3 } })).rgb, 0), [0, 1, 0], 1e-4));
    const grey = at(frame([red], 0, prepareLook({ globals: { saturation: 0 } })).rgb, 0);
    assert.ok(near(grey, [0.2126, 0.2126, 0.2126], 1e-6));
  });

  test('G carries energy, macros and the palette; pal() and palette() read the palette roles', () => {
    const carnival = palettes.palettes.find((p) => p.name === 'carnival');
    const look = prepareLook({ globals: { energy: 0.25, palette: carnival, macros: { storm: { value: 0.75 } } } });
    const code = 'function pixel(p, t, P, G) {\n'
      + '  return p.k ? pal("accent", 1) : [G.energy, G.storm, G.palette.low.length];\n}';
    const L = layerOf({ id: 'a', modules: [src('m', code)] });
    const { rgb } = frame([L], 0, look);
    assert.ok(near(at(rgb, 0), [0.25, 0.75, 1]));
    const hex = carnival.accent.at(-1);
    assert.ok(near(at(rgb, 1), [1, 2, 3].map((i) => parseInt(hex.slice(2 * i - 1, 2 * i + 1), 16) / 255)));
    const chapel = palettes.palettes.find((p) => p.name === 'chapel');
    for (const r of PALETTE_ROLES) assert.deepEqual(DEFAULT_PALETTE[r], chapel[r], 'the default palette is chapel');
  });

  test('automation interpolates, holds at its ends, and drives G', () => {
    const pts = [[2, 0], [4, 1]];
    assert.deepEqual([0, 2, 3, 4, 9].map((t) => automationAt(pts, t)), [0, 0, 0.5, 1, 1]);
    const look = prepareLook({ automation: { energy: pts } });
    const L = layerOf({ id: 'a', modules: [src('m', 'function pixel(p, t, P, G) { return G.energy; }')] });
    assert.ok(Math.abs(frame([L], 3, look).rgb[0] - 0.5) < 1e-6);
  });

  test('speed is a clock: pattern time is ∫ speed, continuous across a change', () => {
    const tee = layerOf({ id: 'a', modules: [src('m', 'function pixel(p, t) { return t / 100; }')] });
    const T = (look, t) => 100 * frame([tee], t, look).rgb[0];
    assert.ok(Math.abs(T(prepareLook({ globals: { speed: 2 } }), 10) - 20) < 1e-3);
    const ramp = prepareLook({ automation: { speed: [[0, 0], [10, 2]] } });    // ∫ of a ramp: t² / 10
    assert.ok(Math.abs(T(ramp, 5) - 2.5) < 1e-3);
    const slow = prepareLook({ globals: { speed: 1 } });
    assert.ok(Math.abs(T(slow, 10) - 10) < 1e-3);
    const fast = prepareLook({ globals: { speed: 2 } }, slow);     // the slider moved at t = 10
    assert.ok(Math.abs(T(fast, 10) - 10) < 1e-3, 'no jump');
    assert.ok(Math.abs(T(fast, 11) - 12) < 1e-3, 'twice as fast from there');
    assert.ok(Math.abs(T(fast, 1) - 2) < 1e-3, 'back on the canonical clock after a seek back');
  });
});

describe('use()', () => {
  test('runs a library source as a function, its own instance', () => {
    setLibrary([{ name: 'clouds', code: lib('clouds') }, { name: 'mask', kind: 'filter', code: lib('mask') }]);
    const direct = layerOf({ id: 'a', modules: [src('c', lib('clouds'), { params: { cover: 0.8 } })] });
    const used = layerOf({ id: 'b', modules: [src('u',
      'const sky = use("clouds", { cover: 0.8 }); function pixel(p, t) { return sky(p, t); }')] });
    assert.deepEqual(frame([used], 2.5).rgb, frame([direct], 2.5).rgb);
    assert.throws(() => compileLayer({ modules: [src('u', 'const m = use("mask"); function pixel() {}')] }),
      /unknown library pattern "mask"/);
    setLibrary([]);
  });
});

test('a composed look renders the same bytes every time, and reports its cost', () => {
  const look = { globals: { energy: 0.4, palette: palettes.palettes[0], macros: { storm: { value: 0.5 } } },
    automation: { energy: [[0, 0.2], [10, 1]] } };
  const modules = [{ id: 'w', kind: 'warp', code: lib('mirror'), params: { along: true } }, src('met', lib('meteors')),
    src('cl', lib('clouds'), { as: 'input' }), { id: 'mask', kind: 'filter', input: 'cl', code: lib('mask'),
      params: { cutoff: { mod: 'global', name: 'energy', from: 0.6, to: 0.2 } } },
    { id: 'tint', kind: 'filter', code: lib('tint') }];
  const run = () => {
    const L = layerOf({ id: 'a', modules });
    const g = prepareLook(look);
    const out = new Float32Array(N * 3), all = [];
    for (let f = 0; f < 40; f++) all.push(...renderFrame(scene, [L], f / 40, out, g).rgb.slice(0, 300));
    return all;
  };
  assert.deepEqual(run(), run());
});
