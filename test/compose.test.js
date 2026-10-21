// Composition (SPEC "Modules", "Globals", "Param bindings"): module chains, globals, automation and use(), on the
// Folly's rig with our own library modules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import {
  automationAt, compileLayer, compilePattern, DEFAULT_PALETTE, layerModules, PALETTE_ROLES, prepareLayer, prepareLook,
  prepareScene, renderFrame, setLibrary, upgradeGlobals,
} from '../public/js/pattern-core.ts';

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
    const code = lib('single-strand');
    const old = prepareLayer(scene, { id: 'a', code, params: { tail: 20 } }, compilePattern(code));
    const chain = layerOf({ id: 'b', modules: [src('m', code, { params: { tail: 20 } })] });
    assert.deepEqual(layerModules({ title: 'X', code }).map((m) => m.kind), ['source']);
    for (const t of [0, 1.25, 7.5]) assert.deepEqual(frame([chain], t).rgb, frame([old], t).rgb, `t=${t}`);
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

  test('drawing on transparent: an element over a bed is the old element over its own background', () => {
    // The old way: the element blends its colour over a background it paints (by value, as over does). The new: alpha
    // is its coverage, over a bed; or under, so a filter between them reworks the element alone.
    const cover = 'q.lz * q.ly', colour = '[1, 0.5, 0.25]', bed = 'function pixel() { return [0.1, 0.2, 0.6]; }';
    const old = layerOf({ id: 'old', modules: [src('e', `function pixel(q) { const k = ${cover}; `
      + `return [0.1, 0.2, 0.6].map((v, i) => v + (${colour}[i] - v) * k); }`)] });
    const element = src('e', `function pixel(q) { const c = ${colour}; c[3] = ${cover}; return c; }`);
    const over = layerOf({ id: 'over', modules: [src('bed', bed), { ...element, blend: 'over' }] });
    const under = layerOf({ id: 'under', modules: [element, src('bed', bed, { blend: 'under' })] });
    const none = layerOf({ id: 'none', modules: [src('n', 'function pixel() { return null; }')] });
    const [a, b, c, d] = [old, over, under, none].map((L) => frame([L], 0.5).rgb);
    for (let k = 0; k < N; k += 7) {
      assert.ok(near(at(b, k), at(a, k)) && near(at(c, k), at(a, k)), `LED ${k}`);
      assert.deepEqual(at(d, k), [0, 0, 0], 'null: nothing drawn');
    }
  });

  test('a chase masked by clouds: the mask follows how bright the clouds are', () => {
    const modules = [src('met', lib('single-strand')), src('cl', lib('clouds'), { as: 'input' }),
      { id: 'mask', kind: 'filter', input: 'cl', code: lib('mask'), params: { cutoff: 0.5, softness: 0.01 } }];
    const masked = layerOf({ id: 'a', modules });
    const chase = layerOf({ id: 'b', modules: [modules[0]] });
    const clouds = layerOf({ id: 'c', modules: [{ ...modules[1], as: undefined }] });
    const [m, c, s] = [masked, chase, clouds].map((L) => frame([L], 3).rgb.slice());
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

  test('an old look with speed, level, hue and saturation renders as one without them', () => {
    const tee = 'function pixel(p, t, P, G) { return [t / 100, G.energy, 0.5]; }';
    const layers = [{ id: 'a', modules: [src('m', tee)] }], L = layerOf(layers[0]);
    const old = { globals: { energy: 0.3, speed: 2, level: 0.5, hue: 0.2, saturation: 0 },
      automation: { speed: [[0, 1], [9, 2]], level: [[0, 0]] }, layers };
    const now = { globals: { macros: { energy: { value: 0.3, min: 0, max: 1 } } }, layers };
    for (const t of [0, 3, 9]) {
      assert.deepEqual([...frame([L], t, prepareLook(old)).rgb], [...frame([L], t, prepareLook(now)).rgb]);
    }
    assert.ok(Math.abs(frame([L], 9, prepareLook(old)).rgb[0] - 0.09) < 1e-6, 'pattern time is show time');
    assert.equal(upgradeGlobals(now), now, 'a look with nothing old is left alone');
  });

  test('energy is a macro on the looks that use it, and new looks have none', () => {
    const macro = (look) => upgradeGlobals(look).globals?.macros?.energy;
    assert.equal(macro({ globals: {} }), undefined);
    assert.equal(macro({ layers: [{ code: 'function pixel() { return [1, 0, 0]; }' }] }), undefined);
    assert.deepEqual(macro({ globals: { energy: 0.8 } }), { value: 0.8, min: 0, max: 1 });
    assert.deepEqual(macro({ automation: { energy: [[0, 0.2]] } }), { value: 0.5, min: 0, max: 1 });
    const bound = { mod: 'global', name: 'energy', from: 0, to: 2 };
    assert.ok(macro({ layers: [{ modules: [{ params: { v: bound } }] }] }));
    assert.ok(macro({ layers: [{ code: 'function pixel(p, t, P, G) { return [G.energy, 0, 0]; }' }] }));
    const own = { value: 0.1, min: 0, max: 2 };
    assert.equal(macro({ globals: { energy: 0.8, macros: { energy: own } } }), own, 'its own macro stays');
  });

  test('a param bound to energy follows the knob and its lane', () => {
    const code = `const params = { v: { value: 0.5, min: 0, max: 2 } };
      function pixel(p, t, P) { return [P.v / 2, 0, 0]; }`;
    const layer = { id: 'a', modules: [src('m', code, { params: { v: { mod: 'global', name: 'energy', from: 0,
      to: 2 } } })] };
    const look = prepareLook({ globals: { energy: 0.25 }, automation: { energy: [[0, 0], [4, 1]] }, layers: [layer] });
    assert.ok(Math.abs(frame([layerOf(layer)], 2, look).rgb[0] - 0.5) < 1e-6);
  });
});

describe('use()', () => {
  test('runs a library source as a function, its own instance', () => {
    setLibrary([{ name: 'clouds', code: lib('clouds') }, { name: 'mask', kind: 'filter', code: lib('mask') }]);
    const direct = layerOf({ id: 'a', modules: [src('c', lib('clouds'), { params: { cover: 0.8 } })] });
    const used = layerOf({ id: 'b', modules: [src('u',
      'const sky = use("clouds", { cover: 0.8 }); function pixel(p, t) { return sky(p, t); }')] });
    assert.deepEqual(frame([used], 2.5).rgb, frame([direct], 2.5).rgb);
    for (const [name, says] of [['mask', /unknown library pattern "mask"/], ['twinkle', /add the Starfield preset/]]) {
      const code = `const m = use("${name}"); function pixel() {}`;
      assert.throws(() => compileLayer({ modules: [src('u', code)] }), says);
    }
    setLibrary([]);
  });
});

test('a composed look renders the same bytes every time, and reports its cost', () => {
  const look = { globals: { energy: 0.4, palette: palettes.palettes[0], macros: { storm: { value: 0.5 } } },
    automation: { energy: [[0, 0.2], [10, 1]] } };
  const modules = [src('met', lib('single-strand')), src('cl', lib('clouds'), { as: 'input' }), { id: 'mask',
    kind: 'filter', input: 'cl', code: lib('mask'), params: { cutoff: { mod: 'global', name: 'energy', from: 0.6,
      to: 0.2 } } },
  { id: 'tint', kind: 'filter', code: lib('recolour') }, { id: 'w', kind: 'warp', code: lib('mirror'),
    params: { along: true } }];
  const run = () => {
    const L = layerOf({ id: 'a', modules });
    const g = prepareLook(look);
    const out = new Float32Array(N * 3), all = [];
    for (let f = 0; f < 40; f++) all.push(...renderFrame(scene, [L], f / 40, out, g).rgb.slice(0, 300));
    return all;
  };
  assert.deepEqual(run(), run());
});
