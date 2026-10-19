// The library's rules (SPEC "Palettes", "Directions", "Modules") and what the extended modules gained: one colours
// pick by position, the shared directions, bands as true swatches, comets, laps, stripes, sparkle as a source, a
// wipe, planes, and Open bound to the hold LFO.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import {
  compileLayer, compileModule, DEFAULT_PALETTE, DIRECTIONS, prepareLayer, prepareLook, prepareScene, renderFrame,
} from '../public/js/pattern-core.ts';
import { folly } from './fixtures/rigs.js';

const here = (p) => new URL(p, import.meta.url);
const index = JSON.parse(readFileSync(here('../public/patterns/index.json'), 'utf8'));
const lib = (name) => readFileSync(here(`../public/patterns/${name}.js`), 'utf8');
const scene = prepareScene(folly);
const modules = index.filter((e) => e.kind !== 'preset');
const mod = (name, kind, params = {}, extra = {}) => ({ id: name, kind, code: lib(name), params, ...extra });
function run(mods, t = 1.25, groups = [], look = null) {
  const layer = { id: 'l', groups, modules: mods }, L = prepareLayer(scene, layer, compileLayer(layer));
  const { rgb, errors } = renderFrame(scene, [L], t, null, look);
  assert.deepEqual(errors, []);
  return { L, rgb: (j) => Array.from(L.buf.subarray(4 * j, 4 * j + 3)), alpha: (j) => L.buf[4 * j + 3], out: rgb };
}
const hexOf = (c) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
const ALL = ['low', 'body', 'accent', 'high'].flatMap((r) => DEFAULT_PALETTE[r]);

describe('the colour rule', () => {
  // Sources that follow it say so by their one colour param; phase by phase the rest move to it.
  const ruled = modules.filter((e) => /\bcolours:\s*\{/.test(lib(e.name)));
  test('a module with Colours has that one colour param, the whole palette by default, and names no role', () => {
    assert.ok(ruled.length >= 12, `${ruled.length} modules`);
    for (const { name, kind } of ruled) {
      const { params } = compileModule(lib(name), kind), colour = Object.entries(params).filter(([, p]) => p.type
        === 'color');
      assert.deepEqual(colour.map(([k]) => k), ['colours'], name);
      assert.equal(colour[0][1].value, 'all', `${name}: the whole palette`);
      assert.equal(colour[0][1].label, 'Colours', name);
      assert.doesNotMatch(lib(name), /\bpal\(\s*['"](?:low|body|accent|high)/, `${name}: names no role`);
    }
  });

  test('every direction param offers the shared directions', () => {
    const turned = modules.map(({ name, kind }) => [name, compileModule(lib(name), kind).params.direction])
      .filter(([, d]) => d);
    assert.ok(turned.length >= 5, `${turned.length} modules`);
    for (const [name, d] of turned) assert.deepEqual([d.type, d.options], ['choice', [...DIRECTIONS]], name);
  });
});

describe('bars', () => {
  test('bands are true swatches of the pick, in order, across the direction', () => {
    const { L, rgb } = run([mod('bars', 'source', { softness: 0, speed: 0 })], 0);
    L.idx.forEach((k, j) => assert.ok(ALL.includes(hexOf(rgb(j))), `LED ${k}: ${hexOf(rgb(j))}`));
    const across = run([mod('bars', 'source', { softness: 0, speed: 0, bars: 2, direction: 'right' })], 0);
    across.L.idx.forEach((k, j) => assert.equal(hexOf(across.rgb(j)), ALL[Math.floor(across.L.lz[j] * 2)], `LED ${k}`));
  });

  test('duty leaves the rest clear; pulse and comet draw on transparent; round wraps whole', () => {
    for (const profile of ['step', 'pulse', 'comet']) {
      const { L, alpha } = run([mod('bars', 'source', { duty: 0.4, profile, softness: 0.05 })]);
      const a = Array.from(L.idx, (_, j) => alpha(j));
      const clear = a.filter((v) => v === 0).length / a.length;
      assert.ok(clear > 0.4 && clear < 0.8 && a.some((v) => v > 0.9), `${profile}: about 60 % clear (${clear})`);
    }
    const { L, rgb } = run([mod('bars', 'source', { direction: 'round', bars: 2.6, speed: 0, softness: 0 })], 0);
    const seam = L.idx.map((_, j) => j).filter((j) => L.a[j] > 0.98 || L.a[j] < 0.02);
    assert.ok(seam.length && seam.every((j) => hexOf(rgb(j)) === ALL[L.a[j] > 0.5 ? 2 : 0]),
      'three whole bars round: no fourth at the seam');
  });
});

describe('single strand', () => {
  test('a comet\'s head is the last colour, its tail fading behind; laps leave strands clear', () => {
    const params = { profile: 'comet', colours: '#0000ff #ff0000', size: 30, tail: 6, speed: 40, lap: 120 };
    const { L, rgb, alpha } = run([mod('single-strand', 'source', params)], 2, ['arches']);
    let heads = 0, clear = 0;
    L.idx.forEach((k, j) => {
      if (alpha(j) > 0.9) { heads++; assert.ok(rgb(j)[0] > 0.85 && rgb(j)[2] < 0.15, `LED ${k}: a red head`); }
      if (alpha(j) === 0) clear++;
    });
    assert.ok(heads > 10 && clear > L.idx.length / 3, `heads ${heads}, clear ${clear}`);
  });

  test('scatter starts each strand apart; alternate runs every other back', () => {
    // Each arch strand's LEDs, lit or clear, from its start.
    const strands = (params) => {
      const { L, alpha } = run([mod('single-strand', 'source', { gap: 0.5, ...params })], 1, ['arches']);
      const out = new Map();
      L.idx.forEach((k, j) => out.set(scene.fixture[k], (out.get(scene.fixture[k]) ?? '') + (alpha(j) > 0.5 ? 1 : 0)));
      return out;
    };
    const starts = (m) => new Set([...m.values()].filter((a) => a.length >= 40).map((a) => a.slice(0, 40)));
    assert.equal(starts(strands({})).size, 1, 'alike without scatter');
    assert.ok(starts(strands({ scatter: 1 })).size > 5, 'apart with scatter');
    // Two strands of one length side by side: the odd one runs back.
    const arches = scene.fixtures.map((f, i) => ({ ...f, i })).filter((f) => /arch/.test(f.zone ?? ''));
    const even = arches.find((f) => f.i % 2 === 0 && arches.some((g) => g.i === f.i + 1 && g.count === f.count));
    const plain = strands({}), turned = strands({ alternate: true });
    assert.equal(turned.get(even.i), plain.get(even.i), 'an even strand runs as before');
    assert.equal(turned.get(even.i + 1), [...plain.get(even.i + 1)].reverse().join(''), 'the odd one runs back');
  });
});

describe('other sources', () => {
  test('lighthouse: beams in turn on transparent, or stripes that cover', () => {
    const beams = run([mod('lighthouse', 'source')]), stripes = run([mod('lighthouse', 'source',
      { profile: 'stripes' })]);
    const a = beams.L.idx.map((_, j) => beams.alpha(j)), b = stripes.L.idx.map((_, j) => stripes.alpha(j));
    assert.ok(a.some((v) => v === 0) && a.some((v) => v > 0.9) && b.every((v) => v === 1));
  });

  test('sparkle is a source: glints in the pick\'s colours on transparent, pulse or smooth', () => {
    for (const mode of ['pulse', 'smooth']) {
      const { L, rgb, alpha } = run([mod('sparkle', 'source', { mode, colours: '#ff0000 #00ff00' })], 3.1);
      const lit = L.idx.map((_, j) => j).filter((j) => alpha(j) > 0);
      assert.ok(lit.length > 20 && lit.length < L.idx.length * 0.5, `${mode}: ${lit.length} glints`);
      for (const j of lit) assert.ok(['#ff0000', '#00ff00'].includes(hexOf(rgb(j))), `${mode}: ${hexOf(rgb(j))}`);
    }
  });

  test('curtain and rose bloom open as far as Open, which a hold LFO draws', () => {
    const shown = (name, open, t = 0) => {
      const { L, alpha } = run([mod(name, 'source', { open })], t, name === 'rose-bloom' ? ['rose-window'] : []);
      return L.idx.reduce((n, _, j) => n + alpha(j), 0) / L.idx.length;
    };
    assert.ok(shown('curtain', 0) > 0.99 && shown('curtain', 1) < 0.01, 'shut, then open');
    assert.ok(shown('rose-bloom', 0) < 0.01 && shown('rose-bloom', 1) > 0.99, 'a bud, then in flower');
    const held = { mod: 'lfo', shape: 'hold', rate: 0.25, center: 0.5, depth: 0.5 };
    assert.ok(shown('curtain', held, 0) > 0.99 && shown('curtain', held, 1.5) < 0.01, 'the LFO opens it and holds');
  });
});

describe('filters and warps', () => {
  const RED = { id: 'red', kind: 'source', code: 'function pixel() { return [1, 0, 0]; }' };
  test('edge fade: Position wipes along Direction', () => {
    const { L, alpha } = run([RED, mod('edge-fade', 'filter', { position: 0.5, width: 0.02 })]);
    const clear = Array.from(L.idx, (k, j) => [k, j]).filter(([, j]) => Math.abs(L.ly[j] - 0.5) > 0.03);
    assert.ok(clear.length > 1000);
    for (const [k, j] of clear) assert.equal(alpha(j) > 0.5, L.ly[j] > 0.5, `LED ${k}`);
  });

  test('rotate turns in its plane: a quarter turn in plan swaps depth and across', () => {
    const probe = { id: 'p', kind: 'source', code: 'function pixel(q) { return [q.lx, q.lz, q.ly]; }' };
    const { L, rgb } = run([probe, mod('rotate', 'warp', { plane: 'plan', angle: 0.25 })]);
    L.idx.forEach((k, j) => {
      const [x, z, y] = rgb(j);
      assert.ok(Math.abs(x - (1 - L.lz[j])) < 1e-9 && Math.abs(z - L.lx[j]) < 1e-9 && y === L.ly[j], `LED ${k}`);
    });
  });

  test('gradient map and tint walk their one pick; threshold recolours in it', () => {
    const grey = { id: 'g', kind: 'source', code: 'function pixel(q) { return q.ly; }' };
    const map = run([grey, mod('gradient-map', 'filter', { colours: '#ff0000 #0000ff', contrast: 1 })]);
    map.L.idx.forEach((k, j) => {
      const c = map.rgb(j);
      assert.ok(c[1] < 1e-6 && Math.abs(c[0] + c[2] - 1) < 1e-5, `LED ${k}: between the two`);
    });
    const kept = run([grey, mod('threshold', 'filter', { recolour: true, colours: '#00ff00', softness: 0 })]);
    kept.L.idx.forEach((k, j) => assert.deepEqual(kept.rgb(j), kept.L.ly[j] >= 0.5 ? [0, 1, 0] : [0, 0, 0]));
  });

  test('hue shift by Direction', () => {
    const red = run([RED, mod('hue-shift', 'filter', { direction: 'up', spread: 1 / 3, speed: 0 })], 0,
      [], prepareLook(null));
    const top = Array.from(red.L.idx, (k, j) => [k, j]).filter(([, j]) => red.L.ly[j] === 1);
    assert.ok(top.length > 0);
    for (const [k, j] of top) assert.ok(red.rgb(j)[1] > 0.99 && red.rgb(j)[0] < 0.01, `LED ${k}: green at the top`);
  });
});
