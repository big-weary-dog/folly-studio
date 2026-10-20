// Colour picks (SPEC "Palettes"): what pal(role, t) always did is unchanged; a colour param takes a pick at every
// rung of the ladder, step by default; rotate turns without a cut; looks round-trip, a layer's old role remap
// dropped; played and sought land on the same frame.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import {
  compileLayer, compileModule, DEFAULT_PALETTE, prepareLayer, prepareLook, prepareScene, renderFrame, resolveParams,
  setLibrary,
} from '../public/js/pattern-core.ts';
import { LookCreate } from '../shared/schemas/api.ts';
import { dropRemaps } from '../shared/schemas/look.ts';

const here = (p) => new URL(p, import.meta.url);
const rig = JSON.parse(readFileSync(here('../public/data/rig-folly.json'), 'utf8'));
const LIB = JSON.parse(readFileSync(here('./fixtures/library-v1.json'), 'utf8'));
const scene = prepareScene(rig);
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const C = Object.fromEntries(['low', 'body', 'accent', 'high'].flatMap((r) => DEFAULT_PALETTE[r]
  .map((h, i) => [`${r}${i + 1}`, rgbOf(h)])));
const near = (a, b, eps = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps);
const SPARSE = { name: 'sparse', low: ['#6700cb'], body: ['#ee008e', '#ffe068'], accent: [], high: [] };

/** Set the look palette, as a frame does (default: chapel). */
const onPalette = (palette) => renderFrame(scene, [], 0, null, prepareLook({ globals: palette ? { palette } : {} }));
/** A module declaring colour param `c` (`decl`), bound to `value`: its picks and P. */
function slot(decl, value) {
  const m = compileModule(`const params = { c: ${JSON.stringify({ type: 'color', ...decl })} };
    function pixel(p, t, P) { return P.c; }`);
  const params = value === undefined ? {} : { c: value }, P = resolveParams(m.params, params);
  m.picks.bind(m.params, params, P);
  return { pal: m.picks.pal, swatch: m.picks.swatch, P, picks: m.picks };
}
const swatches = (s, n) => Array.from({ length: n }, (_, i) => s.swatch('c', i));

describe('pal(role, t) as before', () => {
  // Frozen from the runtime before picks: float frames at t = 0, 1.3 and 7.9 s, default params, under chapel and a
  // palette with empty roles (sha256, 16 hex), of the library as it was (fixtures/library-v1.json): code that names
  // roles, as saved looks and AI code do. Pinwheel, galaxy and rose-bloom re-made when a r moved to the LEDs' mean.
  const FROZEN = {
    'colour-wash': ['dd699f1a7145cd66', '916774580d47ea34'], garlands: ['07f54027c1481f7c', '36cfd86ee5122fa6'],
    pinwheel: ['eb321a37c8166c45', 'a49fe1b789b5faf7'], wave: ['4719bcc5def8f1c5', '59e1545246665aa1'],
    shimmer: ['8684d0c029f8c471', 'e4e32aae3ab294ef'], galaxy: ['394073bae7a47ef5', 'a493cbc6a9da800c'],
    'rose-bloom': ['9e0750704596e9e4', 'c3398b10b074aa49'], 'canopy-rain': ['e78f0c79325c79b8', 'a24d49b2eaacc6fd'],
    'wash-breathe': ['0dda983da4a43b5c', '2ed1cdb36acda0c4'], circles: ['dd95860b19eb859d', '4d85b0b2a6924573'],
    'arch-chase': ['37fdb44f97a240b9', 'bf8f7ada484978ab'], butterfly: ['f7e3d085dd53f595', '570aa6daf5887bdf'],
  };
  for (const [name, sums] of Object.entries(FROZEN)) {
    test(`${name} renders pixel for pixel as before`, () => {
      [null, SPARSE].forEach((palette, i) => {
        const layer = { id: 'a', code: LIB[name].code };
        const L = prepareLayer(scene, layer, compileLayer(layer)), look = prepareLook({ globals: { palette } });
        const h = createHash('sha256'), rgb = new Float32Array(scene.count * 3);
        for (const t of [0, 1.3, 7.9]) h.update(renderFrame(scene, [L], t, rgb, look).rgb);
        assert.equal(h.digest('hex').slice(0, 16), sums[i], palette ? 'sparse' : 'chapel');
      });
    });
  }

  test('a role walks smoothly, as the ramp did; unknown names fall back to body', () => {
    onPalette();
    const s = slot({ value: '#000000' });
    assert.ok(near(s.pal('body', 0.5), C.body2.map((v, i) => (v + C.body3[i]) / 2)));
    assert.ok(near(s.pal('nope', 0), C.body1));
    assert.ok(near(s.swatch('accent', 4), C.accent2), 'a role\'s swatches wrap');
  });
});

describe('the ladder', () => {
  test('a declared default: body/accent deals in turn, step, so only palette colours', () => {
    onPalette();
    const s = slot({ value: 'body/accent' });
    const want = ['body1', 'accent1', 'body2', 'accent2', 'body3', 'accent3', 'body4', 'accent1'].map((k) => C[k]);
    swatches(s, 9).forEach((c, i) => assert.ok(near(c, want[i % 8]), `swatch ${i}`));
    const seen = new Set();
    for (let k = 0; k <= 400; k++) seen.add(s.pal('c', k / 400).join());
    assert.deepEqual([...seen].sort(), [...new Set(want.map((c) => c.join()))].sort(), 'no in-between values');
    assert.ok(near(s.P.c, C.body1), 'P.c: the first');
  });

  test('roles, slots, mixed, missing slots', () => {
    onPalette();
    assert.ok(swatches(slot({ value: 'accent' }), 3).every((c, i) => near(c, C[`accent${i + 1}`])));
    assert.ok(near(swatches(slot({ value: 'body high' }), 5)[4], C.high1));
    assert.deepEqual(swatches(slot({ value: 'low' }, 'body2 accent1'), 3), [C.body2, C.accent1, C.body2]);
    assert.deepEqual(swatches(slot({ value: 'low' }, 'body9 accent1'), 2), [C.accent1, C.accent1], 'body9: dropped');
    assert.deepEqual(swatches(slot({ value: 'low' }, 'body9'), 4), [C.body1, C.body2, C.body3, C.body4],
      'nothing left: its role');
    assert.deepEqual(swatches(slot({ value: 'low' }, 'body high1/accent'), 4), [C.body1, C.accent1, C.body2,
      C.accent2]);
  });

  test('range and blend: a stretch of a smooth walk, equal bands by step', () => {
    onPalette();
    const smooth = slot({ value: 'body', blend: 'smooth' });
    assert.ok(near(smooth.pal('c', 0.5), C.body2.map((v, i) => (v + C.body3[i]) / 2)));
    const ranged = slot({ value: 'low' }, { pick: 'body', blend: 'smooth', range: [0.5, 1] });
    assert.ok(near(ranged.pal('c', 0), smooth.pal('c', 0.5)) && near(ranged.pal('c', 1), C.body4));
    const step = slot({ value: 'body', blend: 'smooth' }, { pick: 'body', blend: 'step' });
    assert.deepEqual([0, 0.24, 0.26, 0.5, 0.99, 1].map((t) => step.pal('c', t)),
      [C.body1, C.body1, C.body2, C.body3, C.body4, C.body4]);
  });

  test('literals, all and rainbow', () => {
    onPalette();
    assert.deepEqual(slot({ value: 'body' }, '#ff3c00').P.c, [1, 0x3c / 255, 0]);
    assert.deepEqual(slot({ value: 'body' }, [0.5, 0.25, 1]).P.c, [0.5, 0.25, 1], 'an [r, g, b] value is exact');
    assert.deepEqual(slot({ value: 'body' }, 'banana').P.c, C.body1, 'a bad value: the default');
    const lit = slot({ value: '#3a0000 #ff3c00 #fff6d8', blend: 'smooth' });
    assert.ok(near(lit.pal('c', 0.5), rgbOf('#ff3c00')));
    const all = slot({ value: 'all' });
    assert.equal(new Set(swatches(all, 10).map(String)).size, 10, 'all: every colour, low to high');
    assert.ok(near(all.swatch('c', 0), C.low1) && near(all.swatch('c', 9), C.high1));
    const rainbow = slot({ value: 'rainbow', blend: 'smooth' });
    assert.ok(near(rainbow.pal('c', 1 / 12), [1, 0.5, 0], 1e-12) && near(rainbow.pal('c', 1), [1, 0, 0]));
    assert.deepEqual(swatches(slot({ value: 'rainbow' }), 7).map((c) => c.join()).slice(5),
      ['1,0,1', '1,0,0'], 'step: six bands, red once');
  });
});

/** A one-module layer drawing P.c (or `code`) with these params. */
const layerOf = (params, code = 'function pixel(p, t, P) { return P.c; }') => {
  const decl = code.includes('const params') ? '' : "const params = { c: { type: 'color', value: 'body/accent' } };\n";
  const layer = { id: 'l', modules: [{ id: 'm', code: decl + code, params }] };
  return prepareLayer(scene, layer, compileLayer(layer));
};
const first = (L, t, look) => Array.from(renderFrame(scene, [L], t, null, look).rgb.slice(0, 3));

describe('rotate', () => {
  test('bound to an LFO, step holds each colour and crossfades into the next: never a cut', () => {
    const L = layerOf({ c: { pick: 'body/accent', rotate: { mod: 'lfo', shape: 'saw', rate: 0.25, center: 0.5,
      depth: 0.5 } } });
    const look = prepareLook(null), stops = Object.values(C).map(String);
    let prev = first(L, 0, look), held = 0, worst = 0;
    for (let f = 1; f <= 1600; f++) {
      const c = first(L, f / 400, look);
      worst = Math.max(worst, ...c.map((v, i) => Math.abs(v - prev[i])));
      if (stops.includes(c.map((v) => Math.fround(v)).join()) || stops.some((s) => near(c, s.split(',').map(Number),
        1e-6))) held++;
      prev = c;
    }
    assert.ok(worst < 0.06, `largest step between frames 1/400 s apart: ${worst}`);
    assert.ok(held > 1000, `held on a palette colour most of the time (${held} of 1600)`);
  });

  test('a static rotate shifts the stops; a whole turn is none', () => {
    onPalette();
    const s = slot({ value: 'accent' }, { pick: 'accent', rotate: 1 / 3 });
    assert.deepEqual(swatches(s, 3), [C.accent2, C.accent3, C.accent1]);
    assert.deepEqual(swatches(slot({ value: 'accent' }, { pick: 'accent', rotate: 0.999999 }), 1)[0]
      .map((v) => +v.toFixed(4)), C.accent1.map((v) => +v.toFixed(4)));
  });
});

describe('roles in code from before one colour param', () => {
  test('pal(role) reads the look palette\'s role; a declared param of that name wins', () => {
    const look = prepareLook(null), pal = (role) => `function pixel(p) { return pal('${role}', 0); }`;
    assert.deepEqual(first(layerOf({}, pal('accent')), 0, look).map(Math.fround), C.accent1.map(Math.fround));
    const own = `const params = { body: { type: 'color', value: 'accent' } };\n${pal('body')}`;
    assert.deepEqual(first(layerOf({}, own), 0, look).map(Math.fround), C.accent1.map(Math.fround));
  });

  test('use() runs a source that names roles', () => {
    setLibrary([{ name: 'bodyish', code: 'function pixel(p) { return pal("body", 0); }' }]);
    const code = 'const b = use("bodyish");\nfunction pixel(p, t) { return b(p, t); }';
    assert.ok(near(first(layerOf({}, code), 0, prepareLook(null)), C.body1, 1e-6));
    setLibrary([]);
  });

  test('a palette change re-resolves picks and roles', () => {
    const L = layerOf({}, 'function pixel(p, t, P) { return mix(P.c, pal("body", 1), 0.5); }');
    const a = first(L, 0, prepareLook(null)), b = first(L, 0, prepareLook({ globals: { palette: SPARSE } }));
    const want = rgbOf('#ee008e').map((v, i) => Math.fround((v + rgbOf('#ffe068')[i]) / 2));
    assert.ok(!near(a, b, 1e-3) && near(b, want, 1e-6));
  });
});

describe('looks', () => {
  const base = { title: 'Picks', layers: [{ code: 'function pixel() { return 1; }', params: { c: '#ff0000' } }] };
  test('picks round-trip; an old look keeps its shape; a layer\'s role remap is dropped', () => {
    const old = LookCreate.parse(base);
    assert.equal('palette' in old.layers[0], false);
    assert.deepEqual(old.layers[0].params, { c: '#ff0000' });
    const look = { ...base, layers: [{ ...base.layers[0], params: { c: 'body/accent', d: { pick: 'all', blend: 'smooth',
      range: [0.2, 0.8], rotate: { mod: 'lfo', shape: 'saw', unit: 'beats', rate: 0.25 } } },
    palette: { body: 'accent2 accent3', high: { pick: '#ffffff' } } }] };
    const once = LookCreate.parse(look), twice = LookCreate.parse(JSON.parse(JSON.stringify(once)));
    assert.deepEqual(twice, once);
    assert.equal('palette' in once.layers[0], false, 'the remap is dropped');
    assert.deepEqual(once.layers[0].params, look.layers[0].params);
    const stored = [{ id: 'a', palette: { body: 'high' } }, { id: 'b' }], plain = [{ id: 'b' }];
    assert.deepEqual(dropRemaps(stored), [{ id: 'a' }, { id: 'b' }]);
    assert.equal(dropRemaps(plain), plain, 'nothing to drop: the same layers');
  });

  test('played and sought land on the same frame', () => {
    const params = { c: { pick: 'body/accent', rotate: { mod: 'lfo', shape: 'sine', rate: 0.3 } },
      d: { pick: 'all', blend: 'smooth', rotate: { mod: 'lfo', shape: 'saw', rate: 0.1 } } };
    const code = `const params = { c: { type: 'color', value: 'body' }, d: { type: 'color', value: 'all' } };
      function pixel(p, t, P) { return mix(P.c, pal('d', p.ly), 0.5); }`;
    const played = layerOf(params, code), look = prepareLook(null);
    for (let f = 0; f <= 200; f++) renderFrame(scene, [played], f / 40, null, look);
    const sought = renderFrame(scene, [layerOf(params, code)], 5, null, prepareLook(null)).rgb;
    assert.deepEqual(renderFrame(scene, [played], 5, null, look).rgb, sought);
  });
});
