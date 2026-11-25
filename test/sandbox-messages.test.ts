// The relay's reading of what the sandbox's worker says (public/js/sandbox-messages.ts): pattern code shares the
// worker's thread and can post anything, so forged messages are bounded before the app sees them.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  compiledReport, frameAnswer, frameErrors, type Layer, layerTimes, type Paused, renderedAnswer, TEXT_MAX,
} from '../public/js/sandbox-messages.ts';

const look = [{ id: 'a', code: '' }, { id: 'b', code: '' }] as Layer[];
const COUNT = 4;

test('a frame whose rgb is not the rig\'s count × 3 floats is black', () => {
  for (const rgb of [new Float32Array(COUNT * 3 + 1), new Float32Array(1), [1, 1, 1], new Float64Array(COUNT * 3),
    'rgb', null]) {
    const out = frameAnswer({ type: 'frame', rgb }, 1, COUNT, look, null);
    assert.ok(out.rgb instanceof Float32Array && out.rgb.length === COUNT * 3 && out.rgb.every((v) => v === 0));
  }
  const rgb = new Float32Array(COUNT * 3).fill(0.5);
  assert.equal(frameAnswer({ type: 'frame', rgb }, 1, COUNT, look, null).rgb, rgb);
});

test('times are finite and ≥ 0, and only the look\'s layers have one', () => {
  for (const ms of [NaN, -1, Infinity, '5', { valueOf: () => 5 }, undefined]) {
    assert.equal(frameAnswer({ type: 'frame', ms }, 1, COUNT, look, null).ms, 0);
  }
  const raw = JSON.parse('{"a": 0, "b": "3", "c": 2, "__proto__": 9}');
  assert.deepEqual(layerTimes(raw, [...look, { id: '__proto__' } as Layer]), { a: 0 });
  assert.deepEqual(layerTimes({ a: 1.5, b: -2 }, look), { a: 1.5 });
  assert.deepEqual(layerTimes('junk', look), {});
  const many = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`x${i}`, 1]));
  assert.deepEqual(layerTimes(many, look), {});
});

test('errors: one per layer of the look, each a printable line of bounded length', () => {
  const errors = [
    ...Array.from({ length: 10000 }, (_, i) => ({ id: i % 3 ? 'a' : 'stranger', error: 'x' })),
    { id: 'b', module: 'm'.repeat(500), error: `bad\u0000\n\u001b[31m${'y'.repeat(5000)}` },
    null, 'text', 7,
  ];
  const out = frameErrors(errors, look, null);
  assert.deepEqual(out.map((e) => e.id), ['a', 'b']);
  const b = out[1]!;
  assert.equal(b.module!.length, 64);
  assert.equal(b.error.length, TEXT_MAX);
  assert.ok(b.error.startsWith('bad   [31m'));
  assert.deepEqual(frameErrors([{ id: 'a', module: 5, error: { toString: 1 } }], look, null),
    [{ id: 'a', error: 'error' }]);
});

test('paused layers that would play report their pause; nothing to say is the one empty list', () => {
  const pause: Paused = { error: 'Pattern hung' };
  const pausedOf = (l: Layer) => (l.id === 'b' ? pause : null);
  assert.deepEqual(frameErrors([], look, pausedOf), [{ id: 'b', error: 'Pattern hung' }]);
  assert.deepEqual(frameErrors([], [look[0]!, { ...look[1]!, enabled: false }], pausedOf), []);
  assert.deepEqual(frameErrors([{ id: 'b', error: 'own' }], look, pausedOf), [{ id: 'b', error: 'own' }]);
  assert.equal(frameErrors([], look, null), frameErrors(undefined, look, null));
  assert.ok(Object.isFrozen(frameErrors([], look, null)));
});

test('an export is exactly its frames of channels, or an error', () => {
  const bytes = 3 * 510;
  assert.match(String(renderedAnswer({ type: 'rendered' }, 1, bytes, look, null)), /no channel data/);
  assert.match(String(renderedAnswer({ type: 'rendered', channels: [1, 2] }, 1, bytes, look, null)),
    /no channel data/);
  assert.match(String(renderedAnswer({ type: 'rendered', channels: new Uint8Array(bytes + 1) }, 1, bytes, look,
    null)), /wrong amount/);
  const channels = new Uint8Array(bytes);
  assert.deepEqual(renderedAnswer({ type: 'rendered', channels, errors: [{ id: 'a', error: 'e' }] }, 2, bytes, look,
    null), { type: 'rendered', seq: 2, channels, errors: [{ id: 'a', error: 'e' }] });
});

test('a compile report: the look\'s layers only, paused ones in place, its text bounded', () => {
  const schema = { speed: { value: 1 } };
  const report = [
    { id: 'a', ok: false, error: 'z'.repeat(1000), params: 'not an object', modules: [
      { id: 'm1', ok: true, params: schema, upgraded: { speed: [1, 2] } },
      { id: 7, ok: true }, null, { id: 'm2', ok: false, error: '\u0007bell' },
    ] },
    { id: 'stranger', ok: true, params: {} },
  ];
  const [a, b] = compiledReport(look, report, null, new Map());
  assert.equal(a!.error!.length, TEXT_MAX);
  assert.deepEqual(a!.params, {});
  const modules = (a as { modules?: unknown }).modules;
  assert.deepEqual(modules, [{ id: 'm1', ok: true, params: schema, upgraded: { speed: [1, 2] } },
    { id: 'm2', ok: false, params: {}, error: ' bell' }]);
  assert.deepEqual(b, { id: 'b', ok: false, error: 'The sandbox did not report this layer.', params: {} });
  const pausedOf = (l: Layer): Paused | null => (l.id === 'a' ? { error: 'hung', load: true }
    : { error: 'Pattern hung' });
  assert.deepEqual(compiledReport(look, report, pausedOf, new Map([['b', schema]])), [
    { id: 'a', ok: false, error: 'hung', params: {} }, { id: 'b', ok: true, params: schema }]);
});
