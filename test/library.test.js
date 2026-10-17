// The library's house style, beyond rendering at defaults (patterns.test.js): every source holds up under any
// palette and energy, recolours with the look's palette where it reads one, and lands on the same frame whether
// played from the start or sought to; the new warps and filters stack in long chains; all within the frame budget.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { compileLayer, compilePattern, prepareLayer, prepareLook, prepareScene, renderFrame } from
  '../public/js/pattern-core.js';

const here = (p) => new URL(p, import.meta.url);
const cathedral = JSON.parse(readFileSync(here('../public/data/cathedral.json'), 'utf8'));
const index = JSON.parse(readFileSync(here('../public/patterns/index.json'), 'utf8'));
const { palettes } = JSON.parse(readFileSync(here('../public/data/palettes.json'), 'utf8'));
const source = (name) => readFileSync(here(`../public/patterns/${name}.js`), 'utf8');
const scene = prepareScene(cathedral);
const sources = index.filter((e) => e.kind === 'source').map((e) => e.name);
const SECOND = palettes.find((p) => p.name === 'vapour');
const layer = (name, groups = ['cathedral']) => prepareLayer(scene, { id: name, groups }, compilePattern(source(name)));

function check(rgb, what) {
  for (let i = 0; i < rgb.length; i++) {
    const v = rgb[i];
    if (!(Number.isFinite(v) && v >= 0 && v <= 1)) assert.fail(`${what}: rgb[${i}] = ${v}`);
  }
}

describe('each source, under the default palette and another, at low, middle and high energy', () => {
  const looks = [undefined, SECOND].flatMap((palette) => [0, 0.5, 1].map((energy) => ({ palette, energy })));
  for (const name of sources) {
    test(name, () => {
      for (const { palette, energy } of looks) {
        const L = layer(name), look = prepareLook({ globals: { energy, palette } });
        for (const t of [0, 0.8, 3.3, 12.1, 59.9]) {
          const { rgb, errors } = renderFrame(scene, [L], t, undefined, look);
          assert.deepEqual(errors, [], `${palette ? palette.name : 'chapel'}, energy ${energy}, t=${t}`);
          check(rgb, `${name} (${palette ? palette.name : 'chapel'}, energy ${energy}) at t=${t}`);
        }
      }
    });
  }
});

test('sources that read the palette recolour with it', () => {
  const mean = (name, palette) => {
    const { rgb } = renderFrame(scene, [layer(name)], 3.3, undefined, prepareLook({ globals: { palette } }));
    const m = [0, 0, 0];
    for (let k = 0; k < scene.count; k++) for (let c = 0; c < 3; c++) m[c] += rgb[3 * k + c] / scene.count;
    return m;
  };
  const users = sources.filter((name) => /\b(pal|palette)\(/.test(source(name)));
  assert.ok(users.length >= 25, `${users.length} sources use the palette`);
  for (const name of users) {
    const a = mean(name, undefined), b = mean(name, SECOND);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.08, `${name}: ${a} vs ${b}`);
  }
});

test('each source lands on the same frame played from the start as sought to, and on a second run', () => {
  const ends = [4.0371, 1.5193];                // forward through the frames, then back (a loop, a seek)
  const groups = ['spires', 'rose-window', 'canopy'];
  for (const name of sources) {
    const played = layer(name, groups), again = layer(name, groups);
    const a = new Float32Array(scene.count * 3), b = new Float32Array(scene.count * 3);
    let t = 0;
    for (const end of ends) {
      for (; t < end; t += 0.025) renderFrame(scene, [played], t, a);
      renderFrame(scene, [played], end, a);
      renderFrame(scene, [again], end, b);
      for (let i = 0; i < a.length; i++) {
        if (Math.abs(a[i] - b[i]) > 1e-4) assert.fail(`${name} at t=${end}: rgb[${i}] ${a[i]} played, ${b[i]} sought`);
      }
    }
  }
});

describe('warps and filters in long chains', () => {
  const mod = (id, kind, extra = {}) => ({ id, kind, code: source(id), ...extra });
  const CHAINS = {
    'repeat, mosaic and turn plasma, then map, shift, sparkle and fade it': [mod('radial-repeat', 'warp'),
      mod('mosaic', 'warp'), mod('rotate', 'warp'), mod('plasma', 'source'), mod('gradient-map', 'filter'),
      mod('hue-shift', 'filter'), mod('sparkle', 'filter'), mod('edge-fade', 'filter')],
    'fold and swirl meteors, masked by clouds, with trails': [mod('mirror', 'warp'), mod('kaleidoscope', 'warp'),
      mod('scroll', 'warp'), mod('twist', 'warp'), mod('meteors', 'source'), mod('clouds', 'source', { as: 'input' }),
      mod('mask', 'filter', { input: 'clouds' }), mod('trails', 'filter')],
    'every colour filter over bars': [mod('bars', 'source'), mod('threshold', 'filter'), mod('posterize', 'filter'),
      mod('invert', 'filter'), mod('tint', 'filter'), mod('gradient-map', 'filter'), mod('hue-shift', 'filter'),
      mod('sparkle', 'filter')],
  };
  for (const [what, modules] of Object.entries(CHAINS)) {
    test(what, () => {
      const base = modules.find((m) => m.kind === 'source');
      const L = prepareLayer(scene, { id: 'chain', modules }, compileLayer({ modules }));
      const plain = prepareLayer(scene, { id: 'plain', modules: [base] }, compileLayer({ modules: [base] }));
      const out = new Float32Array(scene.count * 3);
      let changed = 0;
      for (const t of [0, 0.4, 2.2, 9.7, 33.3]) {
        const a = renderFrame(scene, [plain], t).rgb;
        const { rgb, errors } = renderFrame(scene, [L], t, out);
        assert.deepEqual(errors, [], `t=${t}`);
        check(rgb, `${what} at t=${t}`);
        for (let i = 0; i < rgb.length; i++) if (Math.abs(rgb[i] - a[i]) > 0.02) changed++;
      }
      assert.ok(changed > 0.2 * scene.count * 3 * 5, `the chain reworks its source (${changed})`);
      const t0 = performance.now();
      for (let f = 0; f < 20; f++) renderFrame(scene, [L], 40 + f / 40, out);
      const ms = (performance.now() - t0) / 20;
      assert.ok(ms < 25, `${ms.toFixed(1)} ms per frame for eight modules over the whole cathedral`);
    });
  }
});
