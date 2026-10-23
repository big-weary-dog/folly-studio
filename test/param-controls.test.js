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
