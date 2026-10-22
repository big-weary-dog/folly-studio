// Noise: every kind covers the layer with a field of its own, smooth kinds are smooth along a strand while static is
// per LED, Seed deals another field, and Speed 0 holds it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import { compileLayer, prepareLayer, prepareScene, renderFrame } from '../public/js/pattern-core.ts';
import { folly } from './fixtures/rigs.js';

const code = readFileSync(new URL('../public/patterns/noise.js', import.meta.url), 'utf8');
const scene = prepareScene(folly);
function field(params, t = 1.5) {
  const mods = [{ id: 'n', kind: 'source', code, params: { colours: '#000000 #ffffff', ...params } }];
  const layer = { id: 'l', modules: mods };
  const L = prepareLayer(scene, layer, compileLayer(layer));
  assert.deepEqual(renderFrame(scene, [L], t).errors, []);
  return { L, v: Array.from(L.idx, (_, j) => L.buf[4 * j]), a: Array.from(L.idx, (_, j) => L.buf[4 * j + 3]) };
}
const KINDS = ['smooth', 'layered', 'ridged', 'cells', 'static'];
const differ = (a, b) => a.filter((x, j) => Math.abs(x - b[j]) > 0.02).length / a.length;
// The mean step between consecutive LEDs on a strand, over the spread of the whole field.
function roughness({ L, v }) {
  let sum = 0, n = 0;
  for (let j = 1; j < v.length; j++) {
    if (scene.fixture[L.idx[j]] !== scene.fixture[L.idx[j - 1]]) continue;
    sum += Math.abs(v[j] - v[j - 1]); n++;
  }
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  return sum / n / Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
}

describe('noise', () => {
  test('each kind covers every LED with a full, varied field of its own', () => {
    const fields = KINDS.map((kind) => field({ kind }));
    for (const [i, { v, a }] of fields.entries()) {
      assert.ok(a.every((x) => x === 1), `${KINDS[i]}: every LED covered`);
      assert.ok(Math.max(...v) - Math.min(...v) > 0.6, `${KINDS[i]}: spans dark to bright`);
      for (const other of fields.slice(0, i)) assert.ok(differ(v, other.v) > 0.5, `${KINDS[i]} is its own field`);
    }
  });

  test('the shaped kinds are smooth along a strand; static is per LED', () => {
    const r = Object.fromEntries(KINDS.map((kind) => [kind, roughness(field({ kind, size: 0.5 }))]));
    for (const kind of ['smooth', 'layered', 'cells']) assert.ok(r[kind] < 0.3, `${kind}: ${r[kind]}`);
    assert.ok(r.static > 0.8, `static: ${r.static}`);
  });

  test('Seed deals another field; Speed 0 holds it', () => {
    for (const kind of KINDS) {
      assert.ok(differ(field({ kind }).v, field({ kind, seed: 2 }).v) > 0.5, `${kind}: seed`);
      assert.deepEqual(field({ kind, speed: 0 }, 1).v, field({ kind, speed: 0 }, 9).v, `${kind}: held`);
    }
  });
});
