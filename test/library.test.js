// The library's house style, beyond rendering at defaults (patterns.test.js): every module renders on a rig that is
// not the Folly, and every source recolours with the palette and lands on the same frame whether played from the
// start or sought to. Long chains and their cost: npm run perf (library-perf.spec.js).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

// Every module on a rig that is not the Folly: tags stand in for its ids, and a source draws what it finds.
describe('every library module renders finite values on the mini rig', () => {
  const small = prepareScene(mini);
  const BASE = { id: 'b', kind: 'source', code: 'function pixel(p, t) { return [p.x, fract(p.y + t), p.u]; }' };
  const places = [{}, { tags: ['rose'] }, { tags: ['arch'] }, { tags: ['wash', 'canopy'] }, { tags: ['tower'] }];
  for (const e of index.filter((x) => x.kind !== 'preset')) { // presets: presets.test.ts
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

test('each source recolours with the palette, cleanly', () => {
  // The mean hue of what is drawn: each lit LED's colour over its brightest channel, so a sparse source counts too.
  const mean = (name, palette) => {
    const m = [0, 0, 0];
    let lit = 0;
    for (const t of [3.3, 5.05]) {           // a strike of lightning at its defaults, too
      const { rgb, errors } = renderFrame(scene, [layer(name)], t, undefined, prepareLook({ globals: { palette } }));
      assert.deepEqual(errors, [], name);
      check(rgb, `${name} at t=${t}`);
      for (let k = 0; k < scene.count; k++) {
        const top = Math.max(rgb[3 * k], rgb[3 * k + 1], rgb[3 * k + 2]);
        if (top < 0.05) continue;
        lit++;
        for (let c = 0; c < 3; c++) m[c] += rgb[3 * k + c] / top;
      }
    }
    return m.map((v) => v / Math.max(1, lit));
  };
  for (const name of sources) {
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
