// Photosensitivity: no library source's default bake trips the blocking flash check (src/frames.js, large-area
// flashing over 3 a second). Strobe alone may warn, on small regions. Ten seconds of each, baked as the render
// box bakes, spread over worker threads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

const index = JSON.parse(readFileSync(new URL('../public/patterns/index.json', import.meta.url), 'utf8'));
const MAY_WARN = new Set(['strobe']);

function bake(names) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./fixtures/library-bake.js', import.meta.url),
      { workerData: { names, seconds: 10 } });
    w.once('message', resolve);
    w.once('error', reject);
  });
}

test('no library source flashes a large area at its defaults', async (t) => {
  const names = index.filter((e) => e.kind === 'source').map((e) => e.name);
  const n = Math.max(1, Math.min(2, availableParallelism() - 1));     // leave the other test files room
  const shares = Array.from({ length: n }, (_, i) => names.filter((_, j) => j % n === i));
  const results = (await Promise.all(shares.map(bake))).flat();
  assert.equal(results.length, names.length);
  for (const r of results) {
    assert.equal(r.errors, 0, `${r.name}: errors while baking`);
    assert.ok(r.ok, `${r.name}: large-area flashing at ${r.maxHz} a second`);
    if (!MAY_WARN.has(r.name)) assert.deepEqual(r.small, [], `${r.name}: flashing on ${r.small}`);
  }
  const strobe = results.find((r) => r.name === 'strobe');
  t.diagnostic(`strobe: ${strobe.maxHz} flashes a second at most, on a large area`);
});
