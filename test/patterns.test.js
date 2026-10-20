// The built-in library renders cleanly and in colour on the Folly: its sources alone (one that fills its layer mostly
// lit; one that draws on transparent, SPEC "Modules", drawing something), its warps and filters in a chain over a
// source.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { describe, test } from 'vitest';

import {
  compileLayer, compilePattern, MODULE_KINDS, prepareLayer, prepareScene, renderFrame, toChannels,
} from '../public/js/pattern-core.ts';

const here = (p) => new URL(p, import.meta.url);
const rig = JSON.parse(readFileSync(here('../public/data/rig-folly.json'), 'utf8'));
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

test('index.json lists every pattern file, once, and its presets (no file), each with title, summary, tags, kind '
  + 'and category', () => {
  assert.deepEqual(index.filter((e) => e.kind !== 'preset').map((e) => `${e.name}.js`).sort(), files);
  assert.equal(new Set(index.map((e) => e.name)).size, index.length, 'names are unique');
  for (const e of index) {
    assert.match(e.name, /^[a-z0-9-]+$/);
    assert.ok(e.title && e.summary && Array.isArray(e.tags) && e.tags.length, e.name);
    assert.ok(e.summary.length <= 120, `${e.name}: a crisp summary`);
    assert.ok([...MODULE_KINDS, 'preset'].includes(e.kind) && /^[a-z][a-z &-]*$/.test(e.category),
      `${e.name}: kind and category`);
  }
  // A category belongs to one kind, so the shelf's headings never mix them.
  const kindOf = new Map();
  for (const e of index) {
    if (!kindOf.has(e.category)) kindOf.set(e.category, e.kind);
    assert.equal(kindOf.get(e.category), e.kind, `${e.name}: "${e.category}" is a ${kindOf.get(e.category)} category`);
  }
});

test('every choice lists at most 16 options (SPEC-library), so none is cut off where the compiler stops', () => {
  for (const f of files) {
    for (const [, list] of source(f.slice(0, -3)).matchAll(/options: \[([^\]]*)\]/g)) {
      assert.ok(list.match(/'[^']*'/g).length <= 16, `${f}: ${list.replace(/\s+/g, ' ')}`);
    }
  }
});

describe('each source', () => {
  for (const { name } of sources) {
    test(name, () => {
      const code = source(name);
      assert.match(code, /^\/\/ .+/, 'starts with a comment saying what it is');
      const compiled = compilePattern(code);
      let element = false;
      for (const groups of GROUPS) {
        const L = prepareLayer(scene, { id: name, groups }, compiled);
        let lit = 0, colours = new Set();
        for (const t of TIMES) {
          const { rgb, errors } = renderFrame(scene, [L], t);
          assert.deepEqual(errors, [], `${groups} t=${t}`);
          check(rgb, `${name} on ${groups} at t=${t}`);
          L.idx.forEach((k, j) => {
            const r = rgb[3 * k], g = rgb[3 * k + 1], b = rgb[3 * k + 2];
            if (Math.max(r, g, b) > 0.05) lit++;
            if (L.buf[4 * j + 3] < 0.999) element = true;
            colours.add(`${Math.round(r * 8)},${Math.round(g * 8)},${Math.round(b * 8)}`);
          });
        }
        const what = `${name} on ${groups}`, cathedral = groups[0] === 'cathedral';
        // An element is drawn where it is; the whole cathedral shows some of it.
        if (element && !cathedral) continue;
        const share = element ? 0.005 : 0.5;
        assert.ok(lit > share * L.idx.length * TIMES.length, `${what}: ${element ? 'drawn' : 'mostly lit'} (${lit})`);
        const flat = name === 'strobe';             // a strobe flashes one colour at a time
        if (L.idx.length > 50 && !flat) assert.ok(colours.size > 3, `${what}: varies (${colours.size} colours)`);
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
  const base = (kind) => ({ id: 'base', kind: 'source', code: source(kind === 'warp' ? 'clouds' : 'single-strand') });
  for (const { name, kind } of index.filter((e) => e.kind === 'warp' || e.kind === 'filter')) {
    test(name, () => {
      const code = source(name);
      assert.match(code, /^\/\/ .+/, 'starts with a comment saying what it is');
      const input = { id: 'in', kind: 'source', code: source('clouds'), as: 'input' };
      const mod = { id: 'm', kind, code, ...(kind === 'filter' ? { input: 'in' } : {}) };
      const modules = kind === 'warp' ? [base(kind), mod] : [base(kind), input, mod];
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

test('the whole library stacked renders cleanly, into the buffer it is given', () => {
  const blends = ['add', 'over', 'max', 'multiply'];
  const layers = sources.map(({ name }, i) => prepareLayer(scene,
    { id: name, groups: GROUPS[i % GROUPS.length], blend: blends[i % 4], level: 0.8 }, compilePattern(source(name))));
  const out = new Float32Array(scene.count * 3);
  const ch = new Uint8Array(scene.frameChannels);
  const frames = 40;
  for (let f = 0; f < frames; f++) {
    const { rgb, errors } = renderFrame(scene, layers, 3 + f / 40, out);
    assert.deepEqual(errors, []);
    assert.equal(rgb, out, 'no new frame buffer');
    toChannels(scene, rgb, ch);
  }
  check(out, 'stack');
});
