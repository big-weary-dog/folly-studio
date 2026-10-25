// Photosensitivity: no library source's default bake, nor any preset as the Studio adds it, trips the blocking
// flash check (src/frames.ts, large-area flashing over 3 a second). Strobe alone may warn, on small regions. Ten
// seconds of each, baked as the render box bakes, spread over worker threads.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

import { test } from 'vitest';

import { presetLayers, withPresetGlobals } from '../public/js/ui/model.ts';
import { cog } from './fixtures/rigs.js';

const index = JSON.parse(readFileSync(new URL('../public/patterns/index.json', import.meta.url), 'utf8'));
const MAY_WARN = new Set(['strobe']);

function bake(names, seconds = 10) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./fixtures/library-bake.js', import.meta.url),
      { workerData: { names, seconds } });
    w.once('message', resolve);
    w.once('error', reject);
  });
}

test('no library source flashes a large area at its defaults', async () => {
  const names = index.filter((e) => e.kind === 'source').map((e) => e.name);
  const n = Math.max(1, Math.min(2, availableParallelism() - 1));     // leave the other test files room
  const shares = Array.from({ length: n }, (_, i) => names.filter((_, j) => j % n === i));
  const results = (await Promise.all(shares.map((s) => bake(s)))).flat();
  assert.equal(results.length, names.length);
  for (const r of results) {
    assert.equal(r.errors, 0, `${r.name}: errors while baking`);
    assert.ok(r.ok, `${r.name}: large-area flashing at ${r.maxHz} a second`);
    if (!MAY_WARN.has(r.name)) assert.deepEqual(r.small, [], `${r.name}: flashing on ${r.small}`);
  }
  const strobe = results.find((r) => r.name === 'strobe');
  console.info(`strobe: ${strobe.maxHz} flashes a second at most, on a large area`);
});

test('fireflies all in step, at their fastest and longest, stay under it', async () => {
  const params = { pull: 0.5, rate: 90, spread: 0, scatter: 0, flash: 1 };
  const results = await bake([{ name: 'fireflies', params }, { name: 'fireflies', params: { ...params, by: 'arch' } }],
    20);
  for (const r of results) assert.ok(r.ok && r.errors === 0, `fireflies: ${r.maxHz} a second, ${r.errors} errors`);
});

test('lightning at its fastest and widest stays under it', async () => {
  const results = await bake([{ name: 'lightning', params: { speed: 2, width: 0.15, glow: 0.15 } }], 20);
  for (const r of results) assert.ok(r.ok && r.errors === 0, `lightning: ${r.maxHz} a second, ${r.errors} errors`);
});

test('no preset flashes a large area, as the Studio adds it', async () => {
  const library = index.map((e) => ({ ...e, title: e.title || e.name, code: e.kind === 'preset' ? ''
    : readFileSync(new URL(`../public/patterns/${e.name}.js`, import.meta.url), 'utf8') }));
  const names = library.filter((e) => e.kind === 'preset').map((p) => ({ name: p.name,
    layers: presetLayers(p, library, cog), look: { globals: withPresetGlobals(null, p) } }));
  const n = Math.max(1, Math.min(2, availableParallelism() - 1));
  const shares = Array.from({ length: n }, (_, i) => names.filter((_, j) => j % n === i));
  const results = (await Promise.all(shares.map((s) => bake(s)))).flat();
  assert.equal(results.length, names.length);
  for (const r of results) {
    assert.equal(r.errors, 0, `${r.name}: errors while baking`);
    assert.ok(r.ok, `${r.name}: large-area flashing at ${r.maxHz} a second`);
    if (r.small.length) console.info(`${r.name}: flashing on small regions ${r.small}`);
  }
});
