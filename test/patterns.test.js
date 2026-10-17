// The built-in pattern library renders cleanly, quickly, and in colour on the real cathedral.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { compilePattern, prepareScene, prepareLayer, renderFrame, toChannels } from '../public/js/pattern-core.js';

const here = (p) => new URL(p, import.meta.url);
const cathedral = JSON.parse(readFileSync(here('../public/data/cathedral.json'), 'utf8'));
const index = JSON.parse(readFileSync(here('../public/patterns/index.json'), 'utf8'));
const files = readdirSync(here('../public/patterns/')).filter((f) => f.endsWith('.js')).sort();
const source = (name) => readFileSync(here(`../public/patterns/${name}.js`), 'utf8');
const scene = prepareScene(cathedral);
const TIMES = [0, 0.37, 1.5, 4.2, 17.9, 63.25, 600.1];
const GROUPS = [['cathedral'], ['rose-window'], ['spires'], ['main-arch-3'], ['canopy', 'wash', 'spirelets'],
  ['rose-ring-5']];

function check(rgb, what) {
  for (let i = 0; i < rgb.length; i++) {
    const v = rgb[i];
    if (!(Number.isFinite(v) && v >= 0 && v <= 1)) assert.fail(`${what}: rgb[${i}] = ${v}`);
  }
}

test('index.json lists every pattern file, once, with title, summary and tags', () => {
  assert.deepEqual(index.map((e) => `${e.name}.js`).sort(), files);
  assert.ok(index.length >= 10);
  for (const e of index) {
    assert.match(e.name, /^[a-z0-9-]+$/);
    assert.ok(e.title && e.summary && Array.isArray(e.tags) && e.tags.length, e.name);
  }
});

describe('each pattern', () => {
  for (const { name } of index) {
    test(name, () => {
      const code = source(name);
      assert.match(code, /^\/\/ .+/, 'starts with a comment saying what it is');
      assert.ok(code.length < 20_000 && /function pixel/.test(code), 'fits the generator limits');
      const compiled = compilePattern(code);
      assert.ok(Object.keys(compiled.params).length > 0, 'has params');
      for (const [k, p] of Object.entries(compiled.params)) {
        if (p.type === 'number') assert.ok(p.min <= p.value && p.value <= p.max, `${k} default within range`);
      }
      for (const groups of GROUPS) {
        const L = prepareLayer(scene, { id: name, groups }, compiled);
        let lit = 0, colours = new Set();
        for (const t of TIMES) {
          const { rgb, errors } = renderFrame(scene, [L], t);
          assert.deepEqual(errors, [], `${groups} t=${t}`);
          check(rgb, `${name} on ${groups} at t=${t}`);
          for (const k of L.idx) {
            const r = rgb[3 * k], g = rgb[3 * k + 1], b = rgb[3 * k + 2];
            if (Math.max(r, g, b) > 0.05) lit++;
            colours.add(`${Math.round(r * 8)},${Math.round(g * 8)},${Math.round(b * 8)}`);
          }
        }
        assert.ok(lit > 0.5 * L.idx.length * TIMES.length, `${name} on ${groups}: mostly lit (${lit})`);
        if (L.idx.length > 50) assert.ok(colours.size > 3, `${name} on ${groups}: varies (${colours.size} colours)`);
      }
      // Params at their extremes still render cleanly.
      for (const end of ['min', 'max']) {
        const params = Object.fromEntries(Object.entries(compiled.params)
          .filter(([, p]) => p.type === 'number').map(([k, p]) => [k, p[end]]));
        const L = prepareLayer(scene, { id: name, groups: ['cathedral'], params }, compiled);
        for (const t of [0, 2.5]) {
          const { rgb, errors } = renderFrame(scene, [L], t);
          assert.deepEqual(errors, [], `${name} with params at ${end}`);
          check(rgb, `${name} with params at ${end}`);
        }
      }
    });
  }
});

test('the whole library stacked renders well under budget', () => {
  const blends = ['add', 'over', 'max', 'multiply'];
  const layers = index.map(({ name }, i) => prepareLayer(scene,
    { id: name, groups: GROUPS[i % GROUPS.length], blend: blends[i % 4], level: 0.8 }, compilePattern(source(name))));
  const out = new Float32Array(scene.count * 3);
  const ch = new Uint8Array(scene.frameChannels);
  for (let f = 0; f < 5; f++) renderFrame(scene, layers, f / 40, out);   // warm up
  const frames = 40;
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) {
    const { rgb, errors } = renderFrame(scene, layers, 3 + f / 40, out);
    assert.deepEqual(errors, []);
    toChannels(scene, rgb, ch, { gamma: 2.2, brightness: 0.8 });
  }
  const ms = (performance.now() - t0) / frames;
  check(out, 'stack');
  // 13 layers; a single typical layer runs in about 1 ms. Generous for slow CI machines.
  assert.ok(ms < 150, `${ms.toFixed(1)} ms per frame for ${layers.length} layers`);
});

test('a single cathedral-wide layer renders in well under 10 ms', () => {
  for (const { name } of index) {
    const L = prepareLayer(scene, { id: name, groups: ['cathedral'] }, compilePattern(source(name)));
    const out = new Float32Array(scene.count * 3);
    for (let f = 0; f < 5; f++) renderFrame(scene, [L], f / 40, out);
    const t0 = performance.now();
    for (let f = 0; f < 20; f++) renderFrame(scene, [L], 1 + f / 40, out);
    const ms = (performance.now() - t0) / 20;
    assert.ok(ms < 25, `${name}: ${ms.toFixed(2)} ms per frame`);
  }
});
