// The warp contract (SPEC "Modules"): a warp moves the pixel with move(), turn() or slide(), which keep every position
// field consistent, so any warp works over any source, whatever field it reads; and mirror works under anchor.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import { compileLayer, prepareLayer, prepareScene, renderFrame } from '../public/js/pattern-core.ts';
import { cog, folly, lineRig } from './fixtures/rigs.js';

const lib = (name) => readFileSync(new URL(`../public/patterns/${name}.js`, import.meta.url), 'utf8');
const index = JSON.parse(readFileSync(new URL('../public/patterns/index.json', import.meta.url), 'utf8'));
const WARPS = index.filter((e) => e.kind === 'warp').map((e) => e.name);
// A probe reads three fields as its colour (each wrapped into 0..1, so none clamps).
const probe = (...f) => ({ id: 'p', kind: 'source',
  code: `function pixel(q) { return [${f.map((n) => `fract(q.${n} * 0.618)`).join(', ')}]; }` });
const mod = (name, params = {}) => ({ id: name, kind: index.find((e) => e.name === name).kind, code: lib(name),
  params });
// Each warp at settings that move every pixel.
const MOVES = { mirror: { across: true, height: true }, kaleidoscope: { segments: 5, spin: 0.1 },
  'radial-repeat': {}, mosaic: { cells: 5, leds: 4 }, polar: {}, anchor: { tag: 'arch' },
  rotate: { angle: 0.2 }, scroll: { speed: 0.3 }, twist: { swirl: 0.5 }, turbulence: { amount: 0.3 } };

for (const [rigName, rig] of Object.entries({ cog, folly })) {
  const scene = prepareScene(rig);
  const frame = (modules, t = 1.3) => {
    const layer = { id: 'l', modules };
    const L = prepareLayer(scene, layer, compileLayer(layer)), { rgb, errors } = renderFrame(scene, [L], t);
    assert.deepEqual(errors, []);
    return rgb.slice();
  };
  describe(`on ${rigName}`, () => {
    test('every warp keeps the place fields one point: x y z and the frame read the same metres', () => {
      const x = `(q.X - ${scene.bounds.min[0]}) / ${scene.bounds.max[0] - scene.bounds.min[0]}`;
      const check = { id: 'c', kind: 'source', code: `function pixel(q) {
        const ex = abs(q.x - ${x}), el = q.sz > 0 ? abs(q.lz - 0.5 - (q.Z - q.oz) / (2 * q.sz)) : 0;
        const er = q.sr > 0 ? abs(q.r - hypot(q.Z - q.cz, q.Y - q.cy) / q.sr) : 0;
        return [ex > 1e-6 ? 1 : 0, el > 1e-6 ? 1 : 0, er > 1e-6 ? 1 : 0]; }` };
      for (const w of WARPS) {
        if (w === 'anchor') continue;                    // it re-frames: its own a and r (plan, sphere) by design
        const rgb = frame([check, mod(w, MOVES[w])]);
        assert.ok(rgb.every((v) => v === 0), `${w}: a place field disagrees`);
      }
    });

    test('every warp reaches every source: the LED fields follow the point (u, k, seed, fixture)', () => {
      for (const w of WARPS) {
        for (const fields of [['u', 'seed', 'fixture'], ['lz', 'ly', 'lx'], ['a', 'r', 'k']]) {
          if (w === 'anchor' && fields[0] === 'u') continue;      // a frame warp moves no point
          assert.notDeepEqual(frame([probe(...fields), mod(w, MOVES[w])]), frame([probe(...fields)]),
            `${w} over a source reading ${fields}`);
        }
      }
    });

    test('kaleidoscope changes a chase; scroll along changes bars up; mirror works under anchor', () => {
      const chase = mod('single-strand'), bars = mod('bars');
      assert.notDeepEqual(frame([chase, mod('kaleidoscope')]), frame([chase]));
      assert.notDeepEqual(frame([bars, mod('scroll', { direction: 'along', speed: 0.3 })]), frame([bars]));
      const clouds = mod('clouds'), anchor = mod('anchor', { tag: 'arch' }), fold = mod('mirror', { height: true });
      for (const order of [[clouds, anchor, fold], [clouds, fold, anchor]]) {
        assert.notDeepEqual(frame(order), frame([clouds, anchor]), order.map((m) => m.id).join(' → '));
      }
    });
  });
}

test('the LED fields a source reads follow every move above it, through a stack and a copy of the pixel', () => {
  const scene = prepareScene(lineRig(9));
  const probe = { id: 'p', kind: 'source', code: 'function pixel(q) { return [q.k / 8, q.u, q.seed]; }' };
  const shift = (id) => ({ id, kind: 'warp', code: 'function warp(q) { move(q, q.lx, fract(q.ly + 0.25), q.lz); }' });
  const none = { id: 'n', kind: 'source', code: 'function pixel() { return null; }', blend: 'over' };
  const want = (k) => Math.round(8 * (((k / 8 + 0.25) % 1 + 0.25) % 1)) / 8;
  for (const modules of [[probe, shift('a'), shift('b')], [probe, shift('a'), none, shift('b')]]) {
    const layer = { id: 'l', modules }, L = prepareLayer(scene, layer, compileLayer(layer));
    const { rgb, errors } = renderFrame(scene, [L], 0);
    assert.deepEqual(errors, []);
    for (let k = 0; k < 9; k++) assert.ok(Math.abs(rgb[3 * k] - want(k)) < 1e-6, `${modules.length}: LED ${k}`);
  }
});

test('a warp that reads an LED field sees the LED nearest its point, however its code reads it', () => {
  const scene = prepareScene(lineRig(9));
  const probe = { id: 'p', kind: 'source', code: 'function pixel(q) { return [q.k / 8, 0, 0]; }' };
  const shift = { id: 's', kind: 'warp', code: 'function warp(q) { move(q, q.lx, fract(q.ly + 0.25), q.lz); }' };
  for (const read of ['q.k', '(() => { const { k } = q; return k; })()', "q[['k'][0]]"]) {
    const goes = { id: 'g', kind: 'warp', code: `function warp(q) { move(q, q.lx, (${read}) / 8, q.lz); }` };
    const layer = { id: 'l', modules: [probe, goes, shift] }, L = prepareLayer(scene, layer, compileLayer(layer));
    const { rgb } = renderFrame(scene, [L], 0);
    for (let k = 0; k < 9; k++) assert.ok(Math.abs(rgb[3 * k] - ((k / 8 + 0.25) % 1)) < 1e-6, `${read}: LED ${k}`);
  }
});
