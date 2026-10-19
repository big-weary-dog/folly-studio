// The library's house style, beyond rendering at defaults (patterns.test.js): every source holds up under any
// palette and energy, recolours with the look's palette where it reads one, and lands on the same frame whether
// played from the start or sought to; the new warps and filters stack in long chains; all within the frame budget.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { describe, test } from 'vitest';

import { compileLayer, compilePattern, prepareLayer, prepareLook, prepareScene, renderFrame } from
  '../public/js/pattern-core.ts';
import { folly, mini } from './fixtures/rigs.js';

const here = (p) => new URL(p, import.meta.url);
const index = JSON.parse(readFileSync(here('../public/patterns/index.json'), 'utf8'));
const { palettes } = JSON.parse(readFileSync(here('../public/data/palettes.json'), 'utf8'));
const source = (name) => readFileSync(here(`../public/patterns/${name}.js`), 'utf8');
const scene = prepareScene(folly);
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

// Every module on a rig that is not the Folly: tags stand in for its ids, and a source draws what it finds.
describe('every library module renders finite values on the mini rig', () => {
  const small = prepareScene(mini);
  const BASE = { id: 'b', kind: 'source', code: 'function pixel(p, t) { return [p.x, fract(p.y + t), p.u]; }' };
  const places = [{}, { tags: ['rose'] }, { tags: ['arch'] }, { tags: ['wash', 'canopy'] }, { tags: ['tower'] }];
  for (const e of index) {
    test(e.name, () => {
      const modules = e.kind === 'source' ? [{ id: 'm', kind: 'source', code: source(e.name) }]
        : [BASE, { id: 'm', kind: e.kind, code: source(e.name), input: 'b' }];
      for (const [i, place] of places.entries()) {
        const L = prepareLayer(small, { id: 'l', modules, ...place }, compileLayer({ modules }));
        for (const [energy, t] of [[0, 0], [0.5, 3.3], [1, 59.9]]) {
          const { rgb, errors } = renderFrame(small, [L], t, undefined, prepareLook({ globals: { energy } }));
          assert.deepEqual(errors, [], `place ${i}, energy ${energy}, t=${t}`);
          check(rgb, `${e.name} (place ${i}, energy ${energy}) at t=${t}`);
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
      const i = a.findIndex((v, k) => Math.abs(v - b[k]) > 1e-4);
      assert.ok(i < 0, `${name} at t=${end}: rgb[${i}] ${a[i]} played, ${b[i]} sought`);
    }
  }
});

describe('warps and filters in long chains', () => {
  const mod = (id, kind, extra = {}) => ({ id, kind, code: source(id), ...extra });
  const CHAINS = {
    'plasma mapped, shifted, sparkled and faded, then turned, mosaicked and repeated': [mod('plasma', 'source'),
      mod('gradient-map', 'filter'), mod('hue-shift', 'filter'), mod('sparkle', 'filter'), mod('edge-fade', 'filter'),
      mod('rotate', 'warp'), mod('mosaic', 'warp'), mod('radial-repeat', 'warp')],
    'meteors masked by clouds, swirled and folded, with trails': [mod('meteors', 'source'),
      mod('clouds', 'source', { as: 'input' }), mod('mask', 'filter', { input: 'clouds' }), mod('twist', 'warp'),
      mod('scroll', 'warp'), mod('kaleidoscope', 'warp'), mod('mirror', 'warp'), mod('trails', 'filter')],
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

// The shockwave starts at the rose's centre, as the rig's own rose cells place it, wherever its layer lands.
test('the shockwave bursts from the rose window\'s centre', () => {
  const corners = folly.fixtures.filter((f) => f.kind === 'cells').flatMap((f) => f.render.cells.flat());
  const span = (a) => { const v = corners.filter((_, i) => i % 3 === a); return [Math.min(...v), Math.max(...v)]; };
  const centre = [0, 1, 2].map((a) => (span(a)[0] + span(a)[1]) / 2);    // the glass's middle: the Folly's axes
  const rose = new Set(folly.fixtures.filter((f) => f.kind === 'cells')
    .flatMap((f) => Array.from({ length: f.count }, (_, i) => f.start + i)));
  const places = { 'the rose window': { groups: ['rose-window'] }, 'a ring': { groups: ['rose-ring-3'] },
    'the whole Folly': { groups: ['cathedral'] }, 'the rose by tag': { tags: ['rose'] },
    'arches and the rose': { groups: ['arches', 'rose-window'] } };
  for (const [what, place] of Object.entries(places)) {
    const L = prepareLayer(scene, { id: 's', ...place }, compilePattern(source('shockwave')));
    const lum = (rgb, k) => 0.2126 * rgb[3 * k] + 0.7152 * rgb[3 * k + 1] + 0.0722 * rgb[3 * k + 2];
    const peak = new Float64Array(scene.count).fill(-1), at = new Float64Array(scene.count);
    const out = new Float32Array(scene.count * 3);
    for (let t = 0; t < 1.98; t += 0.01) {       // the first wave (every 2 s): when does each LED peak?
      const { rgb } = renderFrame(scene, [L], t, out);
      for (const k of L.idx) if (lum(rgb, k) > peak[k] + 1e-9) [peak[k], at[k]] = [lum(rgb, k), t];
    }
    const first = Math.min(...Array.from(L.idx, (k) => at[k]));
    const lit = [...L.idx].filter((k) => at[k] <= first + 1e-9);
    const mid = [scene.X, scene.Y, scene.Z].map((P) => lit.reduce((s, k) => s + P[k], 0) / lit.length);
    assert.ok(lit.every((k) => rose.has(k)), `${what}: the first lit are rose cells`);
    assert.ok(lit.length >= 8, `${what}: a ring, not a spot (${lit.length} cells)`);
    const off = Math.hypot(mid[0] - centre[0], mid[1] - centre[1], mid[2] - centre[2]);
    assert.ok(off < 0.05, `${what}: the first lit surround a point ${off.toFixed(3)} m from the rose's centre`);
  }
});
