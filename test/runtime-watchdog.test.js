// The runtime's watchdog (SPEC "Sandbox protocol"): a worker silent for over 1 s while it owes an answer is
// restarted without the look, which stays stopped until it changes; a newer look, sent or waiting, gets its turn.
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

test('a look changed while the old one hangs plays on the fresh worker, sent or not', () => {
  const statuses = [], rt = playing(statuses);
  rt.setLook([]);
  vi.advanceTimersByTime(1500);
  assert.equal(workers.length, 2);
  workers[1].say({ type: 'ready' });
  rt.pump(0, true);
  assert.deepEqual(workers[1].sent, ['init', 'look', 'frame'], 'changed before it was sent');
  rt.setLook([]);
  rt.pump(0, true);
  assert.deepEqual(workers[1].sent, ['init', 'look', 'frame', 'look'], 'changed and sent behind what hangs');
  vi.advanceTimersByTime(1500);
  workers[2].say({ type: 'ready' });
  rt.pump(0, true);
  assert.deepEqual(workers[2].sent, ['init', 'look', 'frame']);
  assert.ok(!statuses.includes('stopped'));
});

test('a look sent and then hung while compiling stops', () => {
  const statuses = [], rt = playing(statuses);
  workers[0].say({ type: 'compiled', layers: [] });
  workers[0].say({ type: 'frame', seq: 1 });
  rt.setLook([]);
  rt.pump(0.1, true);
  vi.advanceTimersByTime(1500);
  workers[1].say({ type: 'ready' });
  assert.equal(statuses.at(-1), 'stopped');
});

test('a message that answers nothing asked leaves the watchdog on what is owed', () => {
  const rt = playing([]);
  const stray = [{ type: 'frame', seq: 1 }, { type: 'error', request: 'frame' }, { type: 'rendered' }];
  for (const data of stray) workers[0].say(data);
  workers[0].say({ type: 'compiled', layers: [] });
  for (const data of [...stray.slice(1), { type: 'error', request: 'frame', seq: 9 }, { type: 'frame', seq: 9 }]) {
    workers[0].say(data);
  }
  assert.ok(rt.frameInFlight, 'the frame is still owed');
  vi.advanceTimersByTime(1500);
  assert.equal(workers.length, 2, 'and its hang is found');
});

test('a heartbeat pattern code forges keeps nothing alive', () => {
  playing([]);
  for (let i = 0; i < 3; i++) {
    vi.advanceTimersByTime(500);
    workers[0].say({ type: 'compiling' });
    workers[0].say({ type: 'progress', seq: 1, done: i + 1 });
  }
  assert.equal(workers.length, 2);
});

test('an export\'s progress counts once per frame of it', async () => {
  const rt = playing([]);
  workers[0].say({ type: 'compiled', layers: [] });
  workers[0].say({ type: 'frame', seq: 1 });
  const failed = rt.render({ frames: 2, light: {} }).catch((e) => e.message);
  for (let i = 0; i < 6; i++) {
    vi.advanceTimersByTime(500);
    workers[0].say({ type: 'progress', seq: rt.render_?.seq, done: Math.min(i + 1, 3) });
  }
  assert.equal(workers.length, 2);
  assert.match(await failed, /stopped responding/);
});

test('an export that keeps progressing is never restarted', () => {
  const rt = playing([]);
  workers[0].say({ type: 'compiled', layers: [] });
  workers[0].say({ type: 'frame', seq: 1 });
  void rt.render({ frames: 20, light: {} }).catch(() => {});
  for (let i = 0; i < 10; i++) {
    vi.advanceTimersByTime(500);
    workers[0].say({ type: 'progress', seq: rt.render_.seq, done: i + 1 });
  }
  assert.equal(workers.length, 1);
  rt.destroy();
});
