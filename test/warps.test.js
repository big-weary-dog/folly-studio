// The one rule (SPEC "Modules"): every module works on what is above it, so a warp bends the modules above it, up to
// the nearest stage end (a blur, trails). Checked on the Folly against a plain reading of the rule, module by module.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import {
  compileLayer, compileModule, isStageEnd, prepareLayer, prepareScene, renderFrame, stageOf,
} from '../public/js/pattern-core.ts';
import { addLight } from '../public/js/core/light.ts';

const rig = JSON.parse(readFileSync(new URL('../public/data/rig.json', import.meta.url), 'utf8'));
const lib = (name) => readFileSync(new URL(`../public/patterns/${name}.js`, import.meta.url), 'utf8');
const scene = prepareScene(rig);
const layerOf = (layer) => prepareLayer(scene, layer, compileLayer(layer));
const rgbOf = (L, t = 0) => renderFrame(scene, [L], t).rgb.slice();
const LZ = { id: 's', kind: 'source', code: 'function pixel(p) { return [p.lz, 0, 0]; }' };
const FLIP = { id: 'w', kind: 'warp', code: 'function warp(q) { q.lz = 1 - q.lz; }' };

describe('a warp bends what is above it', () => {
  test('after a source it bends it; before it, nothing', () => {
    const plain = layerOf({ id: 'a', modules: [LZ] });
    const after = layerOf({ id: 'b', modules: [LZ, FLIP] }), before = layerOf({ id: 'c', modules: [FLIP, LZ] });
    const k = plain.idx[5], p = rgbOf(plain), a = rgbOf(after);
    assert.ok(Math.abs(a[3 * k] - (1 - p[3 * k])) < 1e-6);
    assert.deepEqual(rgbOf(before), p);
  });

  test('a stage end stops it: blur and trails hold real LED colours, as their code declares', () => {
    const blur0 = { id: 'b', kind: 'filter', ref: 'blur', code: lib('blur'), params: { radius: 0 } };
    const trails = { id: 't', kind: 'filter', ref: 'trails', code: lib('trails') };
    for (const end of [blur0, trails]) {
      const plain = layerOf({ id: 'a', modules: [LZ, end] });
      assert.deepEqual(rgbOf(layerOf({ id: 'b', modules: [LZ, end, FLIP] })), rgbOf(plain), end.ref);
      assert.notDeepEqual(rgbOf(layerOf({ id: 'c', modules: [LZ, FLIP, end] })), rgbOf(plain), end.ref);
    }
    assert.ok(isStageEnd(blur0) && isStageEnd(trails));
    assert.ok(!isStageEnd({ kind: 'filter', ref: 'mask', code: lib('mask') }));
    assert.ok(!isStageEnd({ kind: 'filter', ref: 'trails', code: 'function filter(c) { return c; }' }), 'not by ref');
    const own = 'export const stage = "history";\nfunction filter(c) { return c; }';
    assert.ok(isStageEnd({ kind: 'filter', code: own }) && !isStageEnd({ kind: 'source', code: own }));
    assert.ok(isStageEnd({ kind: 'filter', code: "const spatial = 'blur';\nfunction filter(c) { return c; }" }));
    assert.ok(!isStageEnd({ kind: 'filter', code: "// const stage = 'history';\nfunction filter(c) { return c; }" }));
    assert.deepEqual([stageOf(blur0), stageOf(trails)], ['spatial', 'history']);
    for (const bad of ["const stage = 'frames';", "const stage = 'spatial';", "const spatial = 'blur';\nconst stage = "
      + "'history';"]) {
      assert.throws(() => compileModule(`${bad}\nfunction filter(c) { return c; }`, 'filter'), /stage must be/, bad);
    }
  });
});

// The rule read plainly: module i reads p bent by the warps below it up to the next stage end, the bottom-most first.
const POOL = {
  w1: 'function warp(q) { q.ly = fract(q.ly * 1.7 + 0.13); }',
  w2: 'function warp(q) { q.lz = 1 - 0.8 * q.lz; }',
  w3: 'function warp(q) { q.ly = q.ly * q.lz; q.lz = fract(q.lz + 0.3); }',
  s1: 'function pixel(p) { return [0.2 * p.ly, 0.1 * p.lz, 0.05]; }',
  s2: 'function pixel(p) { return [0.05, 0.2 * p.lz * p.ly, 0.1 * p.ly]; }',
  f1: 'function filter(c, q) { c[0] = c[0] * (0.5 + 0.5 * q.ly); return c; }',
  f2: 'function filter(c, q) { c[2] = c[2] + 0.1 * q.lz; return c; }',
  t: "const stage = 'history';\nfunction filter(c, q) { c[1] = c[1] + 0.05 * q.ly; return c; }",   // as trails
  b: "const spatial = 'blur';\nfunction filter(c) { return c; }",           // a stage of its own, the identity
};
const fract = (x) => x - Math.floor(x);
const WARPS = { w1: (q) => { q.ly = fract(q.ly * 1.7 + 0.13); }, w2: (q) => { q.lz = 1 - 0.8 * q.lz; },
  w3: (q) => { q.ly *= q.lz; q.lz = fract(q.lz + 0.3); } };
const plus = (c, rgb) => rgb.forEach((v, i) => { c[i] = addLight(c[i], v); });   // light adds (light.test: the curve)
const OPS = { s1: (c, q) => plus(c, [0.2 * q.ly, 0.1 * q.lz, 0.05]),
  s2: (c, q) => plus(c, [0.05, 0.2 * q.lz * q.ly, 0.1 * q.ly]),
  f1: (c, q) => { c[0] *= 0.5 + 0.5 * q.ly; }, f2: (c, q) => { c[2] += 0.1 * q.lz; },
  t: (c, q) => { c[1] += 0.05 * q.ly; }, b: () => {} };
const KIND = { w: 'warp', s: 'source' };
const module = (name, i) => ({ id: `${name}${i}`, kind: KIND[name[0]] ?? 'filter', code: POOL[name], blend: 'add' });

/** The colour the rule gives at a pixel {lz, ly}: sources add (each opaque, so c sums their light), filters rework. */
function expected(names, p) {
  const c = [0, 0, 0];
  names.forEach((name, i) => {
    if (name[0] === 'w') return;
    let end = name === 't' || name === 'b' ? i : i + 1;        // a stage end reads p itself
    while (end < names.length && names[end] !== 't' && names[end] !== 'b') end++;
    const q = { ...p };
    for (let j = end - 1; j > i; j--) if (names[j][0] === 'w') WARPS[names[j]](q);
    OPS[name](c, q);
  });
  return c.map((v) => Math.min(1, Math.max(0, v)));
}

test('random chains render as the rule reads, slot for slot (in place, copies, trails and blur stages)', () => {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const names = Object.keys(POOL);
  let warped = 0;
  for (let n = 0; n < 160; n++) {
    const chain = Array.from({ length: 1 + Math.floor(next() * 8) }, () => names[Math.floor(next() * names.length)]);
    if (chain[0][0] !== 's') chain.unshift('s1');        // c starts empty: a filter there would rework nothing
    const L = layerOf({ id: 'r', groups: ['spires'], modules: chain.map(module) });
    if (L.warps.length) warped++;
    const rgb = rgbOf(L);
    for (let j = 0; j < L.idx.length; j += 7) {
      const k = L.idx[j], want = expected(chain, { lz: L.lz[j], ly: L.ly[j] });
      for (let ch = 0; ch < 3; ch++) {
        assert.ok(Math.abs(rgb[3 * k + ch] - want[ch]) < 1e-5, `${chain.join(' > ')} at LED ${k}: ${rgb[3 * k + ch]} `
          + `is not ${want[ch]}`);
      }
    }
  }
  assert.ok(warped > 60, `${warped} chains bent something`);
});

test('under: the source goes beneath what is above it; onto nothing it is itself', () => {
  const half = 'function pixel() { return [0, 0, 1, 0.5]; }', red = 'function pixel() { return [1, 0, 0, 0.5]; }';
  const at0 = (modules) => Array.from(rgbOf(layerOf({ id: 'u', blend: 'add', modules })).slice(0, 3));
  const over = at0([{ id: 'a', code: red }, { id: 'b', code: half, blend: 'over' }]);
  const under = at0([{ id: 'b', code: half }, { id: 'a', code: red, blend: 'under' }]);
  assert.deepEqual(under, over);
  assert.deepEqual(at0([{ id: 'a', code: red, blend: 'under' }]), at0([{ id: 'a', code: red }]));
});
