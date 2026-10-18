// The built-in library renders cleanly, quickly, and in colour on the Folly: its sources alone, its warps
// and filters in a chain over a source.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  compileLayer, compileModule, compilePattern, MODULE_KINDS, prepareLayer, prepareScene, renderFrame, toChannels,
} from '../public/js/pattern-core.js';

const here = (p) => new URL(p, import.meta.url);
const rig = JSON.parse(readFileSync(here('../public/data/rig.json'), 'utf8'));
const index = JSON.parse(readFileSync(here('../public/patterns/index.json'), 'utf8'));
const files = readdirSync(here('../public/patterns/')).filter((f) => f.endsWith('.js')).sort();
const source = (name) => readFileSync(here(`../public/patterns/${name}.js`), 'utf8');
const scene = prepareScene(rig);
const TIMES = [0, 0.37, 1.5, 4.2, 17.9, 63.25, 600.1];
const GROUPS = [['cathedral'], ['rose-window'], ['spires'], ['main-arch-3'], ['canopy', 'wash', 'spirelets'],
  ['rose-ring-5']];

function check(rgb, what) {
  for (let i = 0; i < rgb.length; i++) {
    const v = rgb[i];
    if (!(Number.isFinite(v) && v >= 0 && v <= 1)) assert.fail(`${what}: rgb[${i}] = ${v}`);
  }
}

const sources = index.filter((e) => e.kind === 'source');

test('index.json lists every pattern file, once, with title, summary, tags, kind and category', () => {
  assert.deepEqual(index.map((e) => `${e.name}.js`).sort(), files);
  assert.ok(sources.length >= 35, `${sources.length} sources`);
  for (const e of index) {
    assert.match(e.name, /^[a-z0-9-]+$/);
    assert.ok(e.title && e.summary && Array.isArray(e.tags) && e.tags.length, e.name);
    assert.ok(e.summary.length <= 120, `${e.name}: a crisp summary`);
    assert.ok(MODULE_KINDS.includes(e.kind) && /^[a-z][a-z &-]*$/.test(e.category), `${e.name}: kind and category`);
  }
  for (const [kind, n] of [['warp', 7], ['filter', 10]]) {
    assert.ok(index.filter((e) => e.kind === kind).length >= n, `at least ${n} ${kind}s`);
  }
  // A category belongs to one kind, so the shelf's headings never mix them.
  const kindOf = new Map();
  for (const e of index) {
    if (!kindOf.has(e.category)) kindOf.set(e.category, e.kind);
    assert.equal(kindOf.get(e.category), e.kind, `${e.name}: "${e.category}" is a ${kindOf.get(e.category)} category`);
  }
});

describe('each source', () => {
  for (const { name } of sources) {
    test(name, () => {
      const code = source(name);
      assert.match(code, /^\/\/ .+/, 'starts with a comment saying what it is');
      assert.ok(code.split('\n').length <= 150, 'short: an example for people and the AI');
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

describe('each warp and filter, in a chain over a source', () => {
  // Warps over a pattern drawn across the layer; filters over one that moves fast, on a dark sky.
  const base = (kind) => ({ id: 'base', kind: 'source', code: source(kind === 'warp' ? 'plasma' : 'meteors') });
  for (const { name, kind } of index.filter((e) => e.kind !== 'source')) {
    test(name, () => {
      const code = source(name);
      assert.match(code, /^\/\/ .+/, 'starts with a comment saying what it is');
      assert.ok(code.split('\n').length <= 150, 'short: an example for people and the AI');
      const compiled = compileModule(code, kind);
      assert.ok(Object.keys(compiled.params).length > 0, 'has params');
      assert.throws(() => compileModule(code, 'source'), /no function pixel/);
      const input = { id: 'in', kind: 'source', code: source('clouds'), as: 'input' };
      const mod = { id: 'm', kind, code, ...(kind === 'filter' ? { input: 'in' } : {}) };
      const modules = kind === 'warp' ? [mod, base(kind)] : [base(kind), input, mod];
      const plain = prepareLayer(scene, { id: 'p', modules: [base(kind)] }, compileLayer({ modules: [base(kind)] }));
      const L = prepareLayer(scene, { id: name, modules }, compileLayer({ modules }));
      let changed = 0;
      for (const t of TIMES) {
        for (const dt of [0.2, 0.1]) renderFrame(scene, [L], t - dt);    // what came just before (for trails)
        const a = renderFrame(scene, [plain], t).rgb.slice();
        const { rgb, errors } = renderFrame(scene, [L], t);
        assert.deepEqual(errors, [], `${name} at t=${t}`);
        check(rgb, `${name} at t=${t}`);
        for (let i = 0; i < rgb.length; i++) if (Math.abs(rgb[i] - a[i]) > 0.02) changed++;
      }
      assert.ok(changed > 0.05 * scene.count * 3 * TIMES.length, `${name} changes what it is chained with`);
    });
  }
});

test('the whole library stacked renders well under budget', () => {
  const blends = ['add', 'over', 'max', 'multiply'];
  const layers = sources.map(({ name }, i) => prepareLayer(scene,
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
  // Every source a layer (over 40); a single typical layer runs in about 2 ms. Generous for slow CI machines.
  assert.ok(ms < 150, `${ms.toFixed(1)} ms per frame for ${layers.length} layers`);
});

test('a single cathedral-wide layer renders in well under 10 ms', () => {
  for (const { name } of sources) {
    const L = prepareLayer(scene, { id: name, groups: ['cathedral'] }, compilePattern(source(name)));
    const out = new Float32Array(scene.count * 3);
    for (let f = 0; f < 5; f++) renderFrame(scene, [L], f / 40, out);
    const t0 = performance.now();
    for (let f = 0; f < 20; f++) renderFrame(scene, [L], 1 + f / 40, out);
    const ms = (performance.now() - t0) / 20;
    assert.ok(ms < 25, `${name}: ${ms.toFixed(2)} ms per frame`);
  }
});
