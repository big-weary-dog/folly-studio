// Groups by tag on any rig: a tag's parts (p.part, p.parts), the modules that take turns by them, and every tag
// choice in the library naming a conventional tag.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import { tagParts } from '../public/js/core/scene.ts';
import { compileLayer, prepareLayer, prepareScene, renderFrame } from '../public/js/pattern-core.ts';
import { at, layerOf } from './fixtures/layers.js';
import { cog, folly } from './fixtures/rigs.js';

const here = (p) => new URL(p, import.meta.url);
const lib = (name) => readFileSync(here(`../public/patterns/${name}.js`), 'utf8');
const COG = prepareScene(cog), FOLLY = prepareScene(folly);

describe('a tag\'s parts', () => {
  test('one tagged group splits into its smallest groups; several tagged groups are the parts', () => {
    const arches = cog.groups.filter((g) => g.parent && /arch-|quad-back-top-.*-/.test(g.id)
      && !cog.groups.some((c) => c.parent === g.id));
    assert.equal(tagParts(COG, 'arch').n, arches.length, 'City of Gods: each arch');
    assert.equal(tagParts(COG, 'tower').n, 2);
    assert.equal(tagParts(FOLLY, 'tower').n, 4);
    assert.equal(tagParts(COG, 'ring').n, 7);
    assert.equal(tagParts(COG, 'no-such-tag').n, 0);
  });

  test('every pixel of a part is in it, parts are numbered 0 up with none empty, and the rest is in none', () => {
    const { of, n } = tagParts(COG, 'arch'), sizes = new Array(n).fill(0);
    for (let k = 0; k < COG.count; k++) if (of[k] >= 0) sizes[of[k]]++;
    assert.ok(sizes.every((s) => s > 0), `${sizes}`);
    assert.ok(of.some((v) => v < 0), 'the rose is in no arch');
  });

  test('the pixel reads them: part and parts', () => {
    const code = 'function pixel(p) { return [(p.part("tower") + 1) / 4, p.parts("tower") / 4, 0]; }';
    const layer = { id: 'l', modules: [{ id: 's', kind: 'source', code }] };
    const L = prepareLayer(COG, layer, compileLayer(layer));
    assert.deepEqual(renderFrame(COG, [L], 0).errors, []);
    const { of } = tagParts(COG, 'tower');
    L.idx.forEach((k, j) => assert.deepEqual([L.buf[4 * j], L.buf[4 * j + 1]], [(of[k] + 1) / 4, 0.5], `LED ${k}`));
  });
});

describe('in-turn on groups', () => {
  const white = ['white', {}, 'function pixel() { return [1, 1, 1, 1]; }'];
  // The mean light of each part at time t, white through In turn on City of Gods.
  function light(params, t) {
    const L = at(layerOf(white, ['in-turn', params]), t);
    const { of, n } = tagParts(COG, params.tag ?? 'arch'), sum = new Array(n).fill(0), count = new Array(n).fill(0);
    L.idx.forEach((k, j) => { if (of[k] >= 0) { sum[of[k]] += L.buf[4 * j + 3]; count[of[k]]++; } });
    return sum.map((s, i) => s / count[i]);
  }
  const brightest = (v) => v.indexOf(Math.max(...v));

  test('each arch takes its turn, forward and back', () => {
    const turn = (start, k) => brightest(light({ gate: 'flash', attack: 0, hold: 0.8, release: 0.1, start }, k + 0.5));
    const n = tagParts(COG, 'arch').n;
    assert.deepEqual([0, 1, 2, n].map((k) => turn('forward', k)), [0, 1, 2, 0]);
    assert.deepEqual([0, 1, 2].map((k) => turn('back', k)), [n - 1, n - 2, n - 3]);
  });

  test('wipe fills along the wire; pixels outside the tag stay dark', () => {
    const v = light({ tag: 'tower', release: 0.2 }, 0.3);
    assert.ok(v[0] > 0.2 && v[0] < 0.6, `tower 0 part filled: ${v[0]}`);
    const L = at(layerOf(white, ['in-turn', { tag: 'tower' }]), 0.3), { of } = tagParts(COG, 'tower');
    L.idx.forEach((k, j) => { if (of[k] < 0) assert.equal(L.buf[4 * j + 3], 0, `LED ${k}`); });
  });
});

test('every tag choice in the library names a conventional tag (SPEC "Rig")', () => {
  const spec = readFileSync(here('../SPEC.md'), 'utf8'), list = /Conventional tags: ([^;]*);/.exec(spec)[1];
  const tags = new Set([...list.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]));
  for (const f of readdirSync(here('../public/patterns/')).filter((f) => f.endsWith('.js'))) {
    for (const m of lib(f.slice(0, -3)).matchAll(/tag: \{[^}]*?options: \[([^\]]*)\]/gs)) {
      for (const o of m[1].match(/'[^']*'/g)) assert.ok(tags.has(o.slice(1, -1)), `${f}: ${o}`);
    }
  }
});
