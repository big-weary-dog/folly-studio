// The light settings (SPEC "Light and output", docs/LIGHT.md): the output transform each value goes out through, on
// the mini rig (GRB), and the stored record admins edit, in a temp data dir.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { addLight, encode, previewChannels, shownLight, toLight, toValue } from '../public/js/core/light.ts';
import { LIGHT, ledChannels, ledLight, lightOf, prepareLight, prepareScene } from '../public/js/pattern-core.ts';
import { createLightStore } from '../src/light.ts';
import { mini } from './fixtures/rigs.js';
import { client, fx, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const scene = prepareScene(mini);
const PANEL = 80;                                       // the panel (tagged rose) starts here; LED 0 is a post

/** LED k's bytes, as r, g, b, after the transform. */
function out(colours, settings = {}, cap = 1) {
  const rgb = new Float32Array(scene.count * 3);
  for (const [k, c] of Object.entries(colours)) rgb.set(c, 3 * k);
  const ch = ledChannels(scene, rgb, prepareLight(scene, lightOf(settings)), null, cap);
  return (k) => [0, 1, 2].map((c) => ch[scene.addr[k] + scene.order[c]]);
}

describe('the output transform', () => {
  test('the curve: an encoded value goes out as 255 · v^2.2, rounded in float', () => {
    const values = [1, 0.75, 0.5, 0.25, 0.1, 0.06, 0.03];
    const bytes = values.map((v) => out({ 0: [v, v, v] })(0)[0]);
    assert.deepEqual(bytes, [255, 135, 55, 12, 2, 1, 0]);
    assert.deepEqual(values.map((v) => out({ 0: [v, v, v] }, { gamma: 1 })(0)[0]), [255, 191, 128, 64, 26, 15, 8],
      'gamma 1 is the values as they are');
  });

  test('balance trims each colour; the floor keeps a lit channel glowing, and never lights a dark one', () => {
    assert.deepEqual(out({ 0: [1, 1, 1] }, { balance: [1, 0.9, 0.8] })(0), [255, 230, 204]);
    assert.deepEqual(out({ 0: [0.03, 0.001, 0] }, { floor: 3 })(0), [3, 0, 0]);
    assert.deepEqual(out({ 0: [0.5, 0.5, 0.5] }, { floor: 3 })(0), [55, 55, 55], 'above the floor: the curve');
  });

  test('a trim dims its group in light; the cap is linear after the curve, so a dim keeps the hue', () => {
    const lit = out({ 0: [1, 0.5, 0.25], [PANEL]: [1, 0.5, 0.25] }, { trims: [{ tag: 'rose', level: 0.5 }] });
    assert.deepEqual(lit(0), [255, 55, 12]);
    assert.deepEqual(lit(PANEL), [128, 28, 6], 'the rose at half light, each channel halved');
    assert.deepEqual(out({ 0: [1, 0.5, 0.25] }, {}, 0.5)(0), [128, 28, 6], 'a cap of ½ is the same');
    assert.deepEqual(out({ 0: [1, 1, 1] }, {}, 0)(0), [0, 0, 0]);
  });

  test('a cap held two frames sends by a table, byte for byte the curve: a dense sweep and every edge', () => {
    // The curve as written in the spec, the oracle: round(255 · min(1, v^gamma · gain)), a lit channel at least floor.
    const want = (v, gamma, gain, floor) => {
      if (!(v > 0) || !(gain > 0)) return 0;
      const b = Math.round(255 * Math.min(1, Math.min(v, 1) ** gamma * gain));
      return b < floor && v * 255 >= 0.5 ? floor : b;
    };
    // Every 997th float32 in 0..1, then round each byte's edge the float64s and float32s either side of it.
    const values = [-0.5, NaN, 1, 1.5, Infinity];
    const bits = new Uint32Array(1), f32 = new Float32Array(bits.buffer), f64 = new Float64Array(1);
    const words = new BigUint64Array(f64.buffer);
    for (let b = 0; b <= 0x3f800000; b += 997) { bits[0] = b; values.push(f32[0]); }
    const settings = [[2.2, [1, 1, 1], 0, 1], [2.2, [1, 0.9, 0.8], 3, 0.62], [1, [0.5, 1, 1], 0, 1],
      [3, [1, 1, 1], 16, 0.3]];
    for (const [gamma, balance, floor, cap] of settings) {
      const edges = [...values];
      for (const g of balance.map((x) => cap * x)) {
        for (let b = 1; b < 256; b++) {
          f64[0] = ((b - 0.5) / 255 / g) ** (1 / gamma);
          for (let d = -4n; d <= 4n; d++) {
            const w = words[0];
            words[0] = w + d; edges.push(f64[0], Math.fround(f64[0])); words[0] = w;
          }
        }
        edges.push(0.5 / 255, Math.fround(0.5 / 255));
      }
      const n = edges.length, sc = { frameChannels: 3 * n, count: n, order: [1, 0, 2],
        addr: Int32Array.from({ length: n }, (_, k) => 3 * k) };
      const rgb = new Float64Array(3 * n);
      for (let k = 0; k < n; k++) rgb.fill(edges[k], 3 * k, 3 * k + 3);
      const light = prepareLight(sc, lightOf({ gamma, balance, floor }));
      ledChannels(sc, rgb, light, null, cap);
      const ch = ledChannels(sc, rgb, light, null, cap);
      assert.equal(light.curves.length, 3, 'tabled');
      let wrong = 0;
      for (let k = 0; k < n; k++) {
        for (let c = 0; c < 3; c++) {
          if (ch[3 * k + sc.order[c]] !== want(edges[k], gamma, cap * balance[c], floor)) wrong++;
        }
      }
      assert.equal(wrong, 0, `gamma ${gamma}, balance ${balance}, floor ${floor}, cap ${cap}`);
    }
  });

  test("ledLight: each byte's light at full output, the curve's own rounding", () => {
    const t = ledLight({ ...LIGHT, balance: [1, 1, 0.5] });
    const byte = (i) => Math.round(t[i] * 255);
    assert.deepEqual([byte(255), byte(128), byte(512 + 255), byte(8)], [255, 56, 128, 0],
      'full; half a byte up from 0.5; blue at half balance; the bottom rounds to off');
  });

  test('lightOf: each field bounded, its default where missing or wrong', () => {
    assert.deepEqual(lightOf(), LIGHT);
    assert.deepEqual(lightOf('x'), LIGHT);
    const l = lightOf({ gamma: 9, balance: [2, -1, 'x'], floor: 2.6, trims: [{ tag: 'rose', level: 3 }, { tag: '' }],
      controller: [] });
    assert.deepEqual(l, { ...LIGHT, gamma: 3, balance: [1, 0, 1], floor: 3, trims: [{ tag: 'rose', level: 1 }],
      controller: [] });
    assert.deepEqual(lightOf({ preview: { exposure: 9, bloom: 'x', focus: 0.1 } }).preview,
      { ...LIGHT.preview, exposure: 2, focus: 0.1 });
    assert.deepEqual(LIGHT.controller.map((c) => c.brightness), [0.8, 0.7], "the F48's own, recorded, never applied");
  });
});

describe('the preview transform', () => {
  const screen = (x) => Math.round(255 * encode(x));
  test('the curve table: a value, its LED byte, and the pixel Points and Playa show for it', () => {
    // Below the shoulder (full drive sits at 0.85 by default) both views show light as is, so their pixel is the
    // screen's encode of the LED's light × the exposure; the probes (docs/LIGHT.md) read these off the GPU.
    const values = [1, 0.75, 0.5, 0.25, 0.1, 0.06, 0.05];
    assert.deepEqual(values.map((v) => out({ 0: [v, v, v] })(0)[0]), [255, 135, 55, 12, 2, 1, 0]);
    assert.deepEqual(values.map((v) => screen(shownLight(v, LIGHT))), [237, 179, 119, 57, 17, 6, 0]);
    assert.deepEqual(values.map((v) => screen(shownLight(v, { ...LIGHT, preview: { ...LIGHT.preview,
      exposure: 1 } }))), [255, 193, 128, 61, 19, 7, 0], 'exposure 1: full drive is the swatch');
  });

  test('the screen encode is the sRGB curve, within a quarter of a code', () => {
    const srgb = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
    for (let i = 0; i <= 1000; i++) assert.ok(Math.abs(encode(i / 1000) - srgb(i / 1000)) < 0.25 / 255);
  });

  test("the engine's light: v^2.2 tabled within 1e-5, mirrored below 0; add sums it", () => {
    for (let i = -1000; i <= 1200; i++) {
      const v = i / 1000, l = Math.sign(v) * Math.abs(v) ** 2.2;
      assert.ok(Math.abs(toLight(v) - l) < 1e-5, `toLight(${v})`);
      assert.ok(Math.abs(toValue(l) - v) < 1e-5, `toValue(${l})`);
    }
    assert.ok(Math.abs(addLight(0.5, 0.5) - 2 ** (1 / 2.2) * 0.5) < 1e-5, 'two halves: 68 %, not 100 %');
    assert.equal(addLight(0, 0.3), 0.3);
    assert.equal(addLight(0.3, 0), 0.3);
  });

  test('dims are light, applied once: the gain, and the dim outside a mask', () => {
    const shown = previewChannels([1, 0.5, 0, 1, 0.5, 0], LIGHT, new Float32Array(6), 0.5, [1, 0], 0.1);
    const half = shownLight(0.5, LIGHT), full = LIGHT.preview.exposure;
    assert.deepEqual([...shown].map((x) => +x.toFixed(5)), [full / 2, half / 2, 0, full / 20, half / 20, 0]
      .map((x) => +x.toFixed(5)), 'inside: × gain; outside: × gain × dim');
    assert.equal(shownLight(0.05, LIGHT), 0, 'off where the LEDs round to off');
    assert.ok(shownLight(0.05, { ...LIGHT, floor: 1 }) > 0, 'the floor lights it, on the screen as on the LEDs');
  });
});

describe('the stored settings', () => {
  test('missing or broken: the defaults; a save is checked, written whole, and read back', () => {
    const file = path.join(fx.tmp, 'light-store', 'light.json'), warned = [];
    const store = createLightStore({ file, log: { warn: (m) => warned.push(m) } });
    assert.deepEqual(store.current(), LIGHT);
    assert.deepEqual(store.save({ ...LIGHT, gamma: 0.5 }), { error: 'gamma must be at least 1.' });
    assert.equal(fs.existsSync(file), false);
    const saved = store.save({ ...LIGHT, gamma: 2.4, trims: [{ tag: 'rose', level: 0.9 }] });
    assert.equal(saved.light.gamma, 2.4);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), saved.light);
    fs.writeFileSync(file, '{ "gamma": 2.6 ');
    assert.deepEqual(store.current(), LIGHT);
    assert.match(warned[0], /light\.json is not valid JSON/);
    fs.writeFileSync(file, '{ "gamma": 2.6 }');
    assert.deepEqual(store.current(), { ...LIGHT, gamma: 2.6 }, 'edited by hand: read again, the rest defaulted');
  });
});

describe('the light API', () => {
  let app, admin, member;
  beforeAll(async () => {
    app = await startApp({ dataDir: path.join(fx.tmp, 'data-light'), admins: 'Olive' });
    admin = await signup(app, 'olive');
    member = await signup(app, 'mona');
  });
  afterAll(() => app?.close());

  test('everyone signed in reads them; only admins save, checked field by field', async () => {
    assert.deepEqual((await member.get('/api/light')).json, LIGHT);
    assert.equal((await client(app).get('/api/light')).status, 401);
    assert.equal((await member.put('/api/admin/light', LIGHT)).status, 403);
    const bad = await admin.put('/api/admin/light', { ...LIGHT, balance: [1, 1] });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /balance/);
    assert.equal((await admin.put('/api/admin/light', { ...LIGHT, floor: 2 })).json.floor, 2);
    assert.equal((await member.get('/api/light')).json.floor, 2);
    assert.ok(fs.existsSync(path.join(fx.tmp, 'data-light', 'light.json')));
  });
});
