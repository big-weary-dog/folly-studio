// Conditional controls pass through compilation without changing playback or discarding hidden saved values.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { test } from 'vitest';

import { normalizeParams } from '../public/js/core/compile.ts';
import { resolveParams } from '../public/js/core/globals.ts';
import { compileLayer, prepareLayer, prepareScene, renderFrame } from '../public/js/pattern-core.ts';
import { normaliseParam, visibleParams } from '../public/js/ui/bindings.ts';
import { folly } from './fixtures/rigs.js';

const lib = (name) => readFileSync(new URL(`../public/patterns/${name}.js`, import.meta.url), 'utf8');
const controls = (schema, saved = {}) => visibleParams(Object.entries(schema)
  .map(([key, p]) => [key, normaliseParam(key, p)]), saved).map(([key]) => key);

test('conditional rows follow default and saved choices while hidden values keep resolving', () => {
  const schema = normalizeParams({
    mode: { value: 'plain', type: 'choice', options: ['plain', 'region'] },
    pick: { value: 'all', type: 'choice', options: ['all', 'one'] },
    index: { value: 0, min: 0, max: 15, showWhen: { mode: ['region'], pick: ['one'] } },
  });
  const saved = { mode: 'plain', pick: 'one', index: 7 };
  assert.deepEqual(controls(schema), ['mode', 'pick']);
  assert.deepEqual(controls(schema, saved), ['mode', 'pick']);
  assert.equal(resolveParams(schema, saved).index, 7);
  assert.deepEqual(controls(schema, { ...saved, mode: 'region' }), ['mode', 'pick', 'index']);
  assert.deepEqual(controls(schema, { ...saved, mode: 'unknown' }), ['mode', 'pick']);
  assert.deepEqual(saved, { mode: 'plain', pick: 'one', index: 7 });
});

test('malformed conditions are ignored instead of hiding a control', () => {
  const schema = normalizeParams({ x: { value: 1, showWhen: { missing: { value: 'yes' } } } });
  assert.deepEqual(controls(schema), ['x']);
});

test('Bars exposes duty and softness only for profiles that use them', () => {
  const layer = { id: 'l', modules: [{ id: 'b', kind: 'source', code: lib('bars') }] };
  const schema = compileLayer(layer)[0].params;
  assert.ok(controls(schema).includes('softness'));
  assert.ok(!controls(schema, { profile: 'smooth', duty: 0.2 }).includes('duty'));
  assert.ok(!controls(schema, { profile: 'pulse' }).includes('softness'));
  assert.ok(controls(schema, { profile: 'pulse' }).includes('duty'));
});

test('Chase, Streaks, Replay and Reorder expose their active shaping controls', () => {
  const schema = (name, kind) => compileLayer({ id: 'l', modules: [{ id: 'm', kind, code: lib(name) }] })[0].params;
  const chase = schema('single-strand', 'source');
  assert.ok(controls(chase).includes('gap'));
  assert.ok(!controls(chase).includes('tail'));
  assert.ok(!controls(chase, { profile: 'comet' }).includes('gap'));
  assert.ok(controls(chase, { profile: 'comet' }).includes('tail'));
  assert.ok(!controls(chase, { mode: 'out' }).includes('alternate'));
  assert.ok(!controls(chase, { mode: 'in' }).includes('alternate'));
  assert.ok(controls(chase, { mode: 'bounce', scatter: 1 }).includes('lap'));
  const streaks = schema('streaks', 'source');
  assert.ok(!controls(streaks).includes('sway'));
  assert.ok(!controls(streaks, { profile: 'flake' }).includes('tail'));
  assert.ok(controls(streaks, { profile: 'flake' }).includes('sway'));
  assert.ok(!controls(schema('replay', 'filter'), { play: 'hold' }).includes('length'));
  const reorder = schema('reorder', 'warp');
  assert.ok(!controls(reorder).includes('seed'));
  assert.deepEqual(controls(reorder, { by: 'random' }), ['by', 'amount', 'seed']);
  assert.deepEqual(controls(reorder, { by: 'groups' }), ['by', 'amount']);
});

test('saved smooth Recolour and negative half-turn preserve their rendered looks', () => {
  const scene = prepareScene(folly);
  // Restore the old declarations and omit migration to compare the old saved value's actual rendering.
  const cases = [
    ['recolour', 'filter', { steps: 0 }, (code) => code.replace('value: 1, min: 1, max: 12',
      'value: 0, min: 0, max: 12')],
    ['ring-turn', 'warp', { step: -8, speed: 0.2 }, (code) => code.replace('min: -7', 'min: -8')],
  ];
  for (const [name, kind, params, legacy] of cases) {
    const current = lib(name), old = legacy(current).replace('function upgrade(', 'function unusedUpgrade(');
    const prepare = (code) => {
      const layer = { id: 'l', modules: [
        { id: 'bed', kind: 'source', code: lib('bars'), params: { direction: 'right', bars: 3 } },
        { id: 'm', kind, code, params },
      ] };
      return prepareLayer(scene, layer, compileLayer(layer));
    };
    const before = prepare(old), after = prepare(current);
    for (const t of [0, 0.4, 1.7, 3]) {
      assert.deepEqual(renderFrame(scene, [before], t).errors, []);
      assert.deepEqual(renderFrame(scene, [after], t).errors, []);
      assert.ok(before.buf.some((v) => v > 0), `${name}: comparison contains light`);
      for (let i = 0; i < before.buf.length; i++) {
        assert.ok(Math.abs(before.buf[i] - after.buf[i]) < 1e-6, `${name}: pixel component ${i} at ${t}`);
      }
    }
  }
});

test('saved fast Strobe speeds and beat clocks still produce six flashes a second', () => {
  const scene = prepareScene(folly);
  for (const speed of [6, { mod: 'beats', per: 3 }]) {
    const layer = { id: 'l', modules: [{ id: 's', kind: 'source', code: lib('strobe'),
      params: { speed, colours: '#ffffff' } }] };
    const prepared = prepareLayer(scene, layer, compileLayer(layer));
    let flashes = 0, wasLit = false;
    for (let frame = 0; frame < 120; frame++) {
      assert.deepEqual(renderFrame(scene, [prepared], frame / 120).errors, []);
      const lit = prepared.buf[3] > 0.05;
      if (lit && !wasLit) flashes++;
      wasLit = lit;
    }
    assert.equal(flashes, 6);
  }
});

test('zero Lightning glow removes the halo while keeping the bolt core', () => {
  const scene = prepareScene(folly);
  const draw = (glow) => {
    const layer = { id: 'l', modules: [{ id: 'b', kind: 'source', code: lib('lightning'),
      params: { glow, width: 0.005, colours: '#ffffff' } }] };
    const prepared = prepareLayer(scene, layer, compileLayer(layer));
    assert.deepEqual(renderFrame(scene, [prepared], 1.13).errors, []);
    return Array.from(prepared.buf);
  };
  const bare = draw(0), halo = draw(0.01);
  assert.ok(bare.some((v) => v > 0), 'a bolt is present');
  assert.ok(halo.some((v, i) => v > 0 && bare[i] === 0), 'halo lights pixels outside the bare core');
});
