// The relay's hung-layer probes (public/js/sandbox-probe.ts): each suspect alone in a throwaway worker, and closing
// the prober mid-recovery ends every probe worker and starts no further batch.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { openProber } from '../public/js/sandbox-probe.ts';

/** A stand-in Worker: says ready on its first message, then answers frames for layers not named `hang`. */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { preventDefault(): void }) => void) | null = null;
  terminated = false;
  layer = '';
  silent: boolean;
  constructor(all: FakeWorker[], silent: boolean) { this.silent = silent; all.push(this); }
  postMessage(m: { type: string; layers?: { id: string }[]; seq?: number }) {
    if (this.silent || this.terminated) return;
    if (m.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
    if (m.type === 'look') this.layer = m.layers![0]!.id;
    if (m.type === 'frame' && this.layer !== 'hang') {
      queueMicrotask(() => this.onmessage?.({ data: { type: 'frame', seq: m.seq } }));
    }
  }
  terminate() { this.terminated = true; }
}

const setup = (l: { id: string }) => [{ type: 'init' }, { type: 'look', layers: [l] }] as [object, object];

test('probes find the layer that hangs, and end every worker they start', async () => {
  const all: FakeWorker[] = [];
  const prober = openProber(() => new FakeWorker(all, false) as unknown as Worker);
  const culprits = await prober.probeAll([{ id: 'a' }, { id: 'hang' }, { id: 'b' }], 1, setup);
  assert.deepEqual(culprits.map((l) => l.id), ['hang']);
  assert.equal(all.length, 3);
  assert.ok(all.every((w) => w.terminated));
});

test('closing mid-recovery ends the probes running and starts no more', async () => {
  const all: FakeWorker[] = [];
  const prober = openProber(() => new FakeWorker(all, true) as unknown as Worker);   // never answer: each waits
  const layers = Array.from({ length: 6 }, (_, i) => ({ id: `l${i}` }));
  const found = prober.probeAll(layers, 1, setup);
  await Promise.resolve();
  assert.equal(all.length, 4, 'the first batch');
  prober.close();
  assert.ok(all.every((w) => w.terminated), 'every running probe ended');
  assert.deepEqual(await found, [], 'inconclusive: nothing blamed');
  assert.equal(all.length, 4, 'no second batch');
});
