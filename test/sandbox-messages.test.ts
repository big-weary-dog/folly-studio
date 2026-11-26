// The runtime's reading of what the sandbox's worker says (public/js/sandbox-messages.ts): pattern code shares the
// worker's thread and can post anything, so forged messages are bounded before the app uses them.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  channelsOf, compiledReport, frameErrors, frameRgb, isTime, type Layer, layerTime, TEXT_MAX,
} from '../public/js/sandbox-messages.ts';

const look = [{ id: 'a', modules: [] }, { id: 'b', modules: [] }] as Layer[];
const COUNT = 4;

test('a frame whose rgb is not the rig\'s count × 3 floats is black', () => {
  const black = new Float32Array(COUNT * 3);
  for (const rgb of [new Float32Array(COUNT * 3 + 1), new Float32Array(1), [1, 1, 1], new Float64Array(COUNT * 3),
    'rgb', null]) {
    assert.equal(frameRgb(rgb, COUNT, black), black);
  }
  const rgb = new Float32Array(COUNT * 3).fill(0.5);
  assert.equal(frameRgb(rgb, COUNT, black), rgb);
});

test('times are finite and ≥ 0, and a layer\'s is its own', () => {
  for (const ms of [NaN, -1, Infinity, '5', { valueOf: () => 5 }, undefined]) assert.equal(isTime(ms), false);
  assert.ok(isTime(0) && isTime(2.5));
  const raw = JSON.parse('{"a": 0, "b": "3", "c": 2, "__proto__": 9}');
  assert.deepEqual(['a', 'b', 'c', '__proto__', 'toString'].map((id) => layerTime(raw, id)), [0, -1, 2, 9, -1]);
  assert.equal(layerTime({ b: -2 }, 'b'), -1);
  assert.equal(layerTime('junk', 'a'), -1);
});

test('errors: one per layer of the look, each a printable line of bounded length', () => {
  const errors = [
    ...Array.from({ length: 10000 }, (_, i) => ({ id: i % 3 ? 'a' : 'stranger', error: 'x' })),
    { id: 'b', module: 'm'.repeat(500), error: `bad\u0000\n\u001b[31m${'y'.repeat(5000)}` },
    null, 'text', 7,
  ];
  const out = frameErrors(errors, look);
  assert.deepEqual(out.map((e) => e.id), ['a', 'b']);
  const b = out[1]!;
  assert.equal(b.module!.length, 64);
  assert.equal(b.error.length, TEXT_MAX);
  assert.ok(b.error.startsWith('bad   [31m'));
  assert.deepEqual(frameErrors([{ id: 'a', module: 5, error: { toString: 1 } }], look),
    [{ id: 'a', error: 'error' }]);
});

test('nothing to say is the one frozen empty list', () => {
  assert.equal(frameErrors([], look), frameErrors(undefined, look));
  assert.ok(Object.isFrozen(frameErrors([], look)));
  assert.equal(frameErrors([{ id: 'stranger', error: 'x' }], look), frameErrors([], look));
});

test('an export is exactly its frames of channels, or an error', () => {
  const bytes = 3 * 510;
  assert.match(String(channelsOf(undefined, bytes)), /no channel data/);
  assert.match(String(channelsOf([1, 2], bytes)), /no channel data/);
  assert.match(String(channelsOf(new Uint8Array(bytes + 1), bytes)), /wrong amount/);
  const channels = new Uint8Array(bytes);
  assert.equal(channelsOf(channels, bytes), channels);
});

test('a compile report: the look\'s layers only, its text bounded', () => {
  const schema = { speed: { value: 1 } };
  const report = [
    { id: 'a', ok: false, error: 'z'.repeat(1000), params: 'not an object', modules: [
      { id: 'm1', ok: true, params: schema, upgraded: { speed: [1, 2] } },
      { id: 7, ok: true }, null, { id: 'm2', ok: false, error: '\u0007bell' },
    ] },
    { id: 'stranger', ok: true, params: {} },
  ];
  const [a, b] = compiledReport(look, report);
  assert.equal(a!.error!.length, TEXT_MAX);
  assert.deepEqual(a!.params, {});
  const modules = (a as { modules?: unknown }).modules;
  assert.deepEqual(modules, [{ id: 'm1', ok: true, params: schema, upgraded: { speed: [1, 2] } },
    { id: 'm2', ok: false, params: {}, error: ' bell' }]);
  assert.deepEqual(b, { id: 'b', ok: false, error: 'The sandbox did not report this layer.', params: {}, modules: [] });
});
