// The runtime's watchdog (SPEC "Sandbox protocol"): a worker silent for over 1 s while it owes an answer is
// restarted without the look, which stays stopped until it changes; a newer look waiting then gets its turn.
import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { Runtime } from '../public/js/runtime.ts';

let workers = [];
class FakeWorker {
  constructor() { this.sent = []; workers.push(this); }
  postMessage(m) { this.sent.push(m.type); }
  terminate() { this.dead = true; }
  say(data) { this.onmessage({ data }); }
}
const RIG = { count: 1, output: { universes: 1, channelsPerUniverse: 3 } };

beforeEach(() => {
  workers = [];
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/** A runtime whose worker is ready and has the look and a frame in flight; `statuses` gets what it says. */
function playing(statuses) {
  const rt = new Runtime({ time: () => 0, onFrame() {}, onCompiled() {}, onFrameErrors() {},
    onStatus: (s) => statuses.push(s) });
  rt.start(RIG, []);
  rt.setLook([]);
  workers[0].say({ type: 'ready' });
  rt.pump(0, true);
  assert.deepEqual(workers[0].sent, ['init', 'look', 'frame']);
  return rt;
}

test('a look that hangs stops until it changes', () => {
  const statuses = [], rt = playing(statuses);
  vi.advanceTimersByTime(900);
  assert.equal(workers.length, 1, 'under 1 s of silence is no hang');
  vi.advanceTimersByTime(600);
  assert.ok(workers[0].dead && workers.length === 2, 'the worker is replaced');
  workers[1].say({ type: 'ready' });
  rt.pump(0, true);
  assert.deepEqual(workers[1].sent, ['init'], 'without the look');
  assert.equal(statuses.at(-1), 'stopped');
  rt.setLook([]);
  assert.equal(statuses.at(-1), 'ready');
  rt.pump(0, true);
  assert.deepEqual(workers[1].sent, ['init', 'look', 'frame'], 'a changed look plays');
});

test('a look changed while the old one hung plays on the fresh worker', () => {
  const statuses = [], rt = playing(statuses);
  rt.setLook([]);
  vi.advanceTimersByTime(1500);
  workers[1].say({ type: 'ready' });
  rt.pump(0, true);
  assert.deepEqual(workers[1].sent, ['init', 'look', 'frame']);
  assert.ok(!statuses.includes('stopped'));
});

test('a worker that keeps answering is never restarted', () => {
  const rt = playing([]);
  for (let i = 0; i < 10; i++) {
    vi.advanceTimersByTime(500);
    workers[0].say({ type: 'compiling' });
  }
  assert.equal(workers.length, 1);
  rt.destroy();
});
