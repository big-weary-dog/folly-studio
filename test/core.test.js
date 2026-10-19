// pattern-core.js: stdlib, compile, scene and layers, compositing, DMX packing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import {
  STDLIB, compilePattern, prepareScene, prepareLayer, renderFrame, toChannels, pixelsForGroups,
} from '../public/js/pattern-core.ts';
import { folly as rig } from './fixtures/rigs.js';

const S = STDLIB;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const nearC = (a, b, eps = 1e-6) => { assert.equal(a.length, b.length); a.forEach((v, i) => near(v, b[i], eps)); };

describe('stdlib', () => {
  test('has every name the SPEC lists', () => {
    const names = `PI TAU sin cos tan asin acos atan atan2 abs min max floor ceil round sqrt pow exp log hypot sign
      clamp fract mix step smoothstep wave tri saw pulse hash rand noise fbm hsv hsl rgb hex scale add gradient
      cosPalette beat dist centres`.split(/\s+/);
    for (const n of names) assert.ok(n in S, n);
    near(S.TAU, 2 * Math.PI);
  });

  test('shaping', () => {
    assert.equal(S.clamp(2), 1); assert.equal(S.clamp(-1), 0); assert.equal(S.clamp(5, 0, 10), 5);
    near(S.fract(-0.25), 0.75); near(S.fract(3.5), 0.5);
    assert.equal(S.step(0.5, 0.4), 0); assert.equal(S.step(0.5, 0.5), 1);
    assert.equal(S.smoothstep(0, 1, -1), 0); assert.equal(S.smoothstep(0, 1, 2), 1); near(S.smoothstep(0, 1, 0.5), 0.5);
    near(S.wave(0), 0.5); near(S.wave(0.25), 1); near(S.wave(0.75), 0);
    near(S.tri(0), 0); near(S.tri(0.5), 1); near(S.tri(1.25), 0.5);
    near(S.saw(1.75), 0.75);
    near(S.pulse(0, 0.1), 1); near(S.pulse(3, 0.1), 1); assert.equal(S.pulse(0.1, 0.1), 0);
    near(S.pulse(0.98, 0.1), S.pulse(0.02, 0.1)); // wraps
    assert.ok(S.pulse(0.05, 0.1) > 0 && S.pulse(0.05, 0.1) < 1);
    assert.equal(S.mix(2, 4, 0.5), 3);
    nearC(S.mix([0, 0, 0], [1, 0.5, 0], 0.5), [0.5, 0.25, 0]);
    nearC(S.mix('#000000', '#ffffff', 0.5), [0.5, 0.5, 0.5]);
  });

  test('hash, rand: stable, in 0..1, spread out', () => {
    assert.equal(S.hash(42), S.hash(42));
    assert.notEqual(S.hash(42), S.hash(43));
    assert.notEqual(S.hash(0.5), S.hash(0.25));
    assert.equal(S.rand(1, 2, 3), S.rand(1, 2, 3));
    assert.notEqual(S.rand(1, 2), S.rand(2, 1));
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const h = S.hash(i), r = S.rand(i, 7), q = S.rand(i * 0.37, 2.5, -i);
      for (const v of [h, r, q]) assert.ok(v >= 0 && v < 1);
      sum += h;
    }
    near(sum / 10000, 0.5, 0.02);
  });

  test('noise and fbm: 0..1, deterministic, smooth', () => {
    for (let i = 0; i < 2000; i++) {
      const x = i * 0.173 - 50, y = i * 0.071, z = -i * 0.03;
      for (const v of [S.noise(x), S.noise(x, y), S.noise(x, y, z), S.noise(x, y, z, i * 0.01), S.fbm(x, y, z), S.fbm(x,
        y, z, 6)]) {
        assert.ok(v >= 0 && v <= 1 && Number.isFinite(v), `${v}`);
      }
      assert.ok(Math.abs(S.noise(x, y, z) - S.noise(x + 1e-4, y, z)) < 0.01, 'continuous');
    }
    assert.equal(S.noise(1.5, 2.5, 3.5), S.noise(1.5, 2.5, 3.5));
    // Not stuck at 0.5 on the integer lattice in 1D.
    assert.ok(new Set([1, 2, 3, 4].map((i) => S.noise(i).toFixed(3))).size > 1);
    // Varied: covers a good part of 0..1.
    let lo = 1, hi = 0;
    for (let i = 0; i < 5000; i++) { const v = S.noise(i * 0.31, i * 0.17, i * 0.07); lo = Math.min(lo,
      v); hi = Math.max(hi, v); }
    assert.ok(lo < 0.15 && hi > 0.85, `${lo}..${hi}`);
  });

  test('colour', () => {
    nearC(S.hex('#ff8000'), [1, 128 / 255, 0]);
    nearC(S.hex('#0f0'), [0, 1, 0]);
    assert.throws(() => S.hex('nope'), /not a colour/);
    const h = S.hex('#123456'); h[0] = 9; nearC(S.hex('#123456'), [0x12 / 255, 0x34 / 255,
      0x56 / 255]); // cache not shared
    nearC(S.hsv(0, 1, 1), [1, 0, 0]); nearC(S.hsv(1 / 3, 1, 1), [0, 1, 0]); nearC(S.hsv(2 / 3, 1, 1), [0, 0, 1]);
    nearC(S.hsv(1.5, 0, 0.5), [0.5, 0.5, 0.5]);
    nearC(S.hsl(0, 1, 0.5), [1, 0, 0]); nearC(S.hsl(0.5, 1, 1), [1, 1, 1]); nearC(S.hsl(0.2, 1, 0), [0, 0, 0]);
    nearC(S.rgb(0.1, 0.2, 0.3), [0.1, 0.2, 0.3]); nearC(S.rgb(0.4), [0.4, 0.4, 0.4]);
    nearC(S.scale([1, 0.5, 0.2], 0.5), [0.5, 0.25, 0.1]);
    nearC(S.add([0.5, 0, 0], '#00ff00'), [0.5, 1, 0]);
    nearC(S.gradient(0, ['#ff0000', '#00ff00', '#0000ff']), [1, 0, 0]);
    nearC(S.gradient(0.5, ['#ff0000', '#00ff00', '#0000ff']), [0, 1, 0]);
    nearC(S.gradient(1, ['#ff0000', '#00ff00', '#0000ff']), [0, 0, 1]);
    nearC(S.gradient(0.25, [[0, 0, 0], [1, 1, 1]]), [0.25, 0.25, 0.25]);
    nearC(S.gradient(7, [[0, 0, 0], [1, 1, 1]]), [1, 1, 1]);
    nearC(S.cosPalette(0, 0.5, 0.5, 1, 0), [1, 1, 1]);
    nearC(S.cosPalette(0.5, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [0, 0, 0]), [0, 0, 0]);
  });

  test('time and space', () => {
    near(S.beat(0.5, 120), 0); near(S.beat(0.25, 120), 0.5); near(S.beat(1.25, 60), 0.25);
    near(S.dist(0, 0, 0, 1, 2, 2), 3); near(S.dist(0, 0, 3, 4), 5);
  });
});

describe('compilePattern', () => {
  test('returns pixel, frame and normalised params', () => {
    const c = compilePattern(`
      const params = { speed: { value: 0.4, min: 0, max: 2 }, color: { value: '#FF6A00', type: 'color' },
                       on: { value: true, type: 'toggle' }, n: 3 };
      function frame(t, P) {}
      function pixel(p, t, P) { return scale(P.color, P.speed); }`);
    assert.equal(typeof c.pixel, 'function');
    assert.equal(typeof c.frame, 'function');
    assert.deepEqual(c.params, {
      speed: { type: 'number', value: 0.4, min: 0, max: 2 },
      color: { type: 'color', value: '#ff6a00' },
      on: { type: 'toggle', value: true },
      n: { type: 'number', value: 3, min: 0, max: 3 },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(c.params)), c.params, 'params are JSON-safe');
  });

  test('forgives export on declarations', () => {
    const c = compilePattern('export const params = { k: 0.5 };\n'
      + 'export function pixel(p, t, P) { return [P.k, 0, 0]; }');
    assert.equal(c.params.k.value, 0.5);
    assert.deepEqual(c.pixel({}, 0, { k: 0.5 }), [0.5, 0, 0]);
  });

  test('stdlib names can be redeclared by the pattern', () => {
    const c = compilePattern('const mix = 1; function noise() { return 0.25; } '
      + 'function pixel() { return [noise(), mix, 0]; }');
    assert.deepEqual(c.pixel(), [0.25, 1, 0]);
  });

  test('syntax error, missing pixel, top-level throw, bad params', () => {
    assert.throws(() => compilePattern('function pixel(p { }'), /^Error: Syntax error: /);
    assert.throws(() => compilePattern('}); (function () {'), /Syntax error/);
    assert.throws(() => compilePattern('const params = {};'), /no function pixel/);
    assert.throws(() => compilePattern(''), /empty/);
    assert.throws(() => compilePattern('throw new Error("boom"); function pixel() {}'), /boom/);
    assert.throws(() => compilePattern('const params = { c: { value: "zz", type: "color" } }; function pixel() {}'),
      /not a colour/);
    assert.throws(() => compilePattern('const params = { s: { value: 1, type: "weird" } }; function pixel() {}'),
      /unknown type/);
  });

  test('dangerous globals are shadowed; strict mode', () => {
    const c = compilePattern(`function pixel() {
      return [typeof fetch, typeof globalThis, typeof window, typeof self, typeof XMLHttpRequest, typeof postMessage];
    }`);
    assert.deepEqual(c.pixel(), Array(6).fill('undefined'));
    const leak = compilePattern('function pixel() { leaked = 1; return [0, 0, 0]; }');
    assert.throws(() => leak.pixel(), ReferenceError);
    assert.equal(globalThis.leaked, undefined);
  });
});

describe('scene and groups', () => {
  const scene = prepareScene(rig);
  const count = (ids) => pixelsForGroups(scene, ids).length;

  test('membership counts', () => {
    assert.equal(count(['cathedral']), 4870);
    assert.equal(count(['rose-petal-07']), 14);
    assert.equal(count(['rose-window']), 224);
    // Cells per petal in each ring, from universe-map.json's cell_order (1b 2a 2c 3b 4a 4c 5a 5b 5c 6a 6c 7a 7b 7c).
    const perPetal = { 1: 1, 2: 2, 3: 1, 4: 2, 5: 3, 6: 2, 7: 3 };
    for (let r = 1; r <= 7; r++) assert.equal(count([`rose-ring-${r}`]), 16 * perPetal[r], `ring ${r}`);
    assert.equal(count(['main-arches']), 1140);
    assert.equal(count(['main-arch-1']), 240);
    assert.equal(count(['mini-arches']), 1100);
    assert.equal(count(['spires']), 416);
    assert.equal(count(['spirelets']), 20);
    assert.equal(count(['canopy']), 252);
    assert.equal(count(['wash']), 22);
    assert.equal(count(['quad-arches']), 1696);
    assert.equal(count(['main-arch-1', 'main-arches']), 1140, 'union, no duplicates');
    assert.equal(count(['spires', 'canopy']), 668);
    assert.throws(() => pixelsForGroups(scene, ['nope']), /unknown group/);
  });

  test('every group parent exists and children sit inside their parents', () => {
    const ids = new Set(rig.groups.map((g) => g.id));
    for (const g of rig.groups) {
      if (g.parent === null) continue;
      assert.ok(ids.has(g.parent), `${g.id} → ${g.parent}`);
      const parent = new Set(pixelsForGroups(scene, [g.parent]));
      for (const k of pixelsForGroups(scene, [g.id])) assert.ok(parent.has(k), `${g.id} pixel ${k} not in ${g.parent}`);
    }
  });

  test('per-LED fields', () => {
    for (let k = 0; k < scene.count; k++) {
      for (const f of ['x', 'y', 'z', 'u', 'seed']) assert.ok(scene[f][k] >= 0 && scene[f][k] <= 1, `${f}[${k}]`);
      assert.ok(scene.i[k] >= 0 && scene.i[k] < scene.n[k]);
    }
    const arch = rig.fixtures[0];
    assert.equal(scene.u[arch.start], 0);
    assert.equal(scene.u[arch.start + arch.count - 1], 1);
    assert.equal(scene.n[arch.start + 5], arch.count);
    const petal7 = pixelsForGroups(scene, ['rose-petal-07']);
    for (const k of petal7) assert.equal(scene.sector[k], 6);
    assert.equal(scene.sector[0], -1);
    assert.equal(new Set(Array.from(scene.seed)).size > 4800, true, 'seeds differ');
  });

  test('a runs clockwise from 12 o\'clock as seen from the playa', () => {
    const c = compilePattern('function pixel(p) { return [p.a, p.r, p.petal]; }');
    const L = prepareLayer(scene, { id: 'a', groups: ['rose-window'] }, c);
    for (let j = 0; j < L.idx.length; j++) {
      const k = L.idx[j];
      if (scene.ring[k] !== 7) continue;          // outer ring: well off-centre
      const petal = scene.sector[k];
      // Petal p is at 22.5° × p clockwise from twelve; within half a petal of that angle.
      let d = Math.abs(L.a[j] - petal / 16); d = Math.min(d, 1 - d);
      assert.ok(d < 1 / 32 + 0.01, `petal ${petal} at a = ${L.a[j]}`);
      assert.ok(L.r[j] > 0.7);
    }
    // Petal 5 (3 o'clock-ish, a ≈ 0.25) is on the viewer's right: +z.
    const right = pixelsForGroups(scene, ['rose-petal-05']);
    assert.ok(Array.from(right).every((k) => scene.Z[k] > -0.443));
  });

  test('lx/ly/lz fill the layer; flat axes sit at 0.5', () => {
    const c = compilePattern('function pixel() {}');
    const L = prepareLayer(scene, { id: 's', groups: ['spire-front-left'] }, c);
    assert.equal(Math.min(...L.ly), 0); assert.equal(Math.max(...L.ly), 1);
    const A = prepareLayer(scene, { id: 'm', groups: ['main-arch-1'] }, c);
    assert.ok(Array.from(A.lx).every((v) => v === 0.5));
    assert.equal(prepareLayer(scene, { id: 'd' }, c).idx.length, 4870, 'no groups = the root');
  });
});

describe('renderFrame', () => {
  const scene = prepareScene(rig);
  const layer = (code, extra = {}) => prepareLayer(scene, { id: extra.id || 'l', groups: ['cathedral'], ...extra },
    compilePattern(code));
  const solid = (r, g, b, a = 1) => `function pixel() { return [${r}, ${g}, ${b}, ${a}]; }`;

  test('blend modes and level', () => {
    const base = layer(solid(0.5, 0.2, 0.8), { id: 'base' });
    const at0 = (layers) => Array.from(renderFrame(scene, layers, 0).rgb.slice(0, 3));
    nearC(at0([base]), [0.5, 0.2, 0.8]);
    nearC(at0([base, layer(solid(0.25, 0.25, 0.25))]), [0.75, 0.45, 1]);                       // add (default), clamps
    nearC(at0([base, layer(solid(1, 0, 0), { blend: 'over', level: 0.5 })]), [0.75, 0.1, 0.4]);
    nearC(at0([base, layer(solid(1, 0, 0, 0.5), { blend: 'over' })]), [0.75, 0.1, 0.4]);       // alpha
    nearC(at0([base, layer(solid(0.3, 0.3, 1), { blend: 'max' })]), [0.5, 0.3, 1]);
    nearC(at0([base, layer(solid(0.5, 1, 0), { blend: 'multiply' })]), [0.25, 0.2, 0]);
    nearC(at0([base, layer(solid(0.5, 1, 0), { blend: 'multiply', level: 0.5 })]), [0.375, 0.2, 0.4]);
    nearC(at0([base, layer(solid(1, 1, 1), { level: 0 })]), [0.5, 0.2, 0.8]);
    nearC(at0([base, layer(solid(1, 1, 1), { enabled: false })]), [0.5, 0.2, 0.8]);
  });

  test('only the layer\'s groups are touched', () => {
    const L = layer(solid(1, 1, 1), { groups: ['rose-petal-01'] });
    const { rgb } = renderFrame(scene, [L], 0);
    let lit = 0;
    for (let k = 0; k < scene.count; k++) if (rgb[3 * k] > 0) lit++;
    assert.equal(lit, 14);
  });

  test('params: defaults, overrides, colours as [r, g, b]', () => {
    const code = `const params = { k: { value: 0.5, min: 0, max: 1 }, c: { value: '#ff0000', type: 'color' } };
      function pixel(p, t, P) { return scale(P.c, P.k); }`;
    nearC(Array.from(renderFrame(scene, [layer(code)], 0).rgb.slice(0, 3)), [0.5, 0, 0]);
    nearC(Array.from(renderFrame(scene, [layer(code, { params: { k: 1, c: '#00ff00' } })], 0).rgb.slice(0, 3)), [0, 1,
      0]);
    nearC(Array.from(renderFrame(scene, [layer(code, { params: { c: [0, 0, 1] } })], 0).rgb.slice(0, 3)), [0, 0, 0.5]);
  });

  test('throwing and NaN layers go black and are reported once', () => {
    const ok = layer(solid(0.2, 0.2, 0.2), { id: 'ok' });
    const boom = layer('function pixel(p) {\n  if (p.k === 7) throw new Error("bad led");\n  return [1, 1, 1];\n}',
      { id: 'boom' });
    const nan = layer('function pixel(p) { return [p.k === 3 ? NaN : 1, 0, 0]; }', { id: 'nan' });
    const frameErr = layer('function frame() { null.x; } function pixel() { return [1, 1, 1]; }', { id: 'fr' });
    const { rgb, errors } = renderFrame(scene, [ok, boom, nan, frameErr], 1);
    assert.equal(errors.length, 3);
    assert.deepEqual(errors.map((e) => e.id), ['boom', 'nan', 'fr']);
    assert.match(errors[0].error, /^Error: bad led \(line 2\)$/);
    assert.match(errors[1].error, /NaN/);
    assert.match(errors[2].error, /TypeError/);
    for (let i = 0; i < rgb.length; i++) near(rgb[i], 0.2, 1e-6);
  });

  test('loose returns: nothing, a number, a hex string', () => {
    const at0 = (code) => Array.from(renderFrame(scene, [layer(code)], 0).rgb.slice(0, 3));
    nearC(at0('function pixel() {}'), [0, 0, 0]);
    nearC(at0('function pixel() { return 0.5; }'), [0.5, 0.5, 0.5]);
    nearC(at0('function pixel() { return "#ff0000"; }'), [1, 0, 0]);
    nearC(at0('function pixel() { return [2, -1, Infinity]; }'), [1, 0, 1]);
  });

  test('reuses its output buffer and one pixel object', () => {
    const out = new Float32Array(scene.count * 3);
    assert.equal(renderFrame(scene, [layer(solid(1, 0, 0))], 0, out).rgb, out);
    const spy = layer('let last = null, same = true;\nfunction pixel(p) { if (last && last !== p) same = false; '
      + 'last = p; return same ? [1, 1, 1] : [0, 0, 0]; }');
    const { rgb } = renderFrame(scene, [spy], 0);
    assert.equal(rgb[3 * (scene.count - 1)], 1);
  });
});

describe('toChannels', () => {
  const scene = prepareScene(rig);
  const csv = readFileSync(new URL('../../td/data/all-pixels-positions.csv', import.meta.url),
    'utf8').trim().split(/\r?\n/);
  const header = csv[0].split(',');
  const rows = csv.slice(1).map((line) => Object.fromEntries(line.split(',').map((v, i) => [header[i], v])));

  test('frame size is universes × 510', () => {
    assert.equal(scene.frameChannels, 40800);
    assert.equal(toChannels(scene, new Float32Array(scene.count * 3)).length, 40800);
  });

  test('addresses match the canonical CSV', () => {
    for (const id of [0, 239, 240, 1140, 2240, 3936, 4352, 4372, 4624, 4646, 4869, 1234, 3333]) {
      const rgb = new Float32Array(scene.count * 3);
      rgb[3 * id] = 1; rgb[3 * id + 1] = 0.5; rgb[3 * id + 2] = 0.25;
      const ch = toChannels(scene, rgb);
      const row = rows[id];
      assert.equal(+row.pixel_id, id);
      const base = (+row.universe - 1) * 510 + (+row.channel - 1);
      assert.deepEqual(Array.from(ch.slice(base, base + 3)), [255, 128, 64],
        `pixel ${id} (${row.zone} u${row.universe} c${row.channel})`);
      let lit = 0;
      for (const v of ch) if (v) lit++;
      assert.equal(lit, 3);
    }
    // Arch Main 1's first pixel is xLights channel 19381 (1-based).
    const rgb = new Float32Array(scene.count * 3); rgb[0] = 1;
    assert.equal(toChannels(scene, rgb).indexOf(255) + 1, 19381);
  });

  test('brightness, then gamma, rounded and clamped', () => {
    const rgb = new Float32Array(scene.count * 3);
    rgb[0] = 0.5; rgb[1] = 2; rgb[2] = -1;
    const base = scene.addr[0];
    const at = (opts) => Array.from(toChannels(scene, rgb, undefined, opts).slice(base, base + 3));
    assert.deepEqual(at(), [128, 255, 0]);
    assert.deepEqual(at({ brightness: 0.5 }), [64, 255, 0]);
    assert.deepEqual(at({ gamma: 2 }), [64, 255, 0]);
    assert.deepEqual(at({ gamma: 2, brightness: 0.5 }), [16, 255, 0]);
    rgb[0] = NaN;
    assert.deepEqual(at(), [0, 255, 0]);
    const out = new Uint8Array(40800).fill(9);
    assert.equal(toChannels(scene, rgb, out, {}), out);
    assert.equal(out[0], 0, 'unused channels cleared');
  });
});
