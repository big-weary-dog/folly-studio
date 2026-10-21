// Relay over the engine's socket, in real time: a scripted sender at 40 fps with jitter takes the lease and its frames
// play; a gap drops the engine to its own render and steady frames bring the relay back; a second sender is refused,
// saying who relays; binary from a socket without the lease is refused; the holder's close frees the lease.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import type { PiState, ToPage } from '../src/protocol.ts';
import { createRelay } from '../src/relay.ts';
import { runLoop } from '../src/run.ts';
import { rig } from './fixture.ts';
import { serve, socket } from './sockets.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LEAD = 8;

/** A sender on `page`: hello, then frames LEAD ahead of the slot the states say, on a jittery 40 fps timer. */
async function sender(page: string) {
  const c = await socket(page);
  c.send({ type: 'hello' });
  await c.next('hello');
  let sent = -1, rev = 0, index = 0, at = 0, paused = false;
  const states = (m: ToPage) => (m.type === 'state' ? m.state as PiState : null);
  c.ws.on('message', (d) => {
    const s = states(JSON.parse(String(d)));
    if (s?.relay && s.look) { index = s.relay.index; at = performance.now(); rev = s.look.rev; }
  });
  let timer: ReturnType<typeof setTimeout>;
  const pump = () => {
    if (!paused && at) {
      const now = Math.floor(index + (performance.now() - at) / 25);
      for (let i = Math.max(sent + 1, now + 1); i <= now + LEAD; i++) {
        const b = new Uint8Array(8 + rig.count * 6), v = new DataView(b.buffer);
        v.setUint32(0, i, true);
        v.setUint32(4, rev, true);
        for (let k = 0; k < rig.count * 3; k++) v.setUint16(8 + k * 2, 20000, true);
        c.ws.send(b);
        sent = i;
      }
    }
    timer = setTimeout(pump, 25 + (Math.random() * 40 - 20));     // ±20 ms of jitter
  };
  pump();
  return { ...c, pause: (on: boolean) => { paused = on; }, stop: () => clearTimeout(timer),
    relay: async (from = c.got.length) => (await c.next('relay', from)) as Extract<ToPage, { type: 'relay' }> };
}

describe('relay over the socket', () => {
  test('a jittery sender plays, a gap falls back and recovers, a second sender is refused', async () => {
    const relay = createRelay({ count: rig.count, fps: 40 });
    const x = await serve('', { t: 0 }, '', 'live', relay);
    const loop = runLoop(x.engine, x.engine.fps);
    const state = () => x.engine.state() && relay.state();
    try {
      const a = await sender(x.page);
      let from = a.got.length;
      a.send({ type: 'relay-start' });
      assert.deepEqual(await a.relay(from), { type: 'relay', holding: true });
      await wait(1500);
      assert.equal(state()?.on, true);
      const misses = state()!.misses;
      assert.ok(misses <= 10, `missed ${misses}`);      // the first few, before the first state arrives

      // A second sender: refused, saying who; its binary refused too.
      const b = await sender(x.page);
      from = b.got.length;
      b.send({ type: 'relay-start' });
      assert.deepEqual(await b.relay(from), { type: 'relay', holding: false,
        error: 'the Pi\'s page is relaying to the lights.' });
      from = b.got.length;
      b.ws.send(new Uint8Array(8 + rig.count * 6));
      assert.match(JSON.stringify(await b.next('error', from)), /relay-start/);
      b.stop();

      // A gap of 400 ms: the engine dips to its own render, and a second of steady frames brings the relay back.
      a.pause(true);
      await wait(400);
      assert.equal(state()?.on, false);
      a.pause(false);
      await wait(1600);
      assert.equal(state()?.on, true);

      // Closing frees the lease for the next.
      a.stop();
      a.ws.close();
      await wait(100);
      assert.equal(relay.state(), null);
      from = b.got.length;
      b.send({ type: 'relay-start' });
      assert.equal((await b.relay(from)).holding, true);
    } finally {
      loop.stop();
    }
  }, 15_000);
});
