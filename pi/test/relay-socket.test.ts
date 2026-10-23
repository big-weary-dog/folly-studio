// Relay over the engine's socket: a scripted sender at 40 fps with injected jitter takes the lease and its frames
// play; a gap drops the engine to its own render and steady frames bring the relay back; a second sender is refused,
// saying who relays; binary from a socket without the lease is refused; the holder's close frees the lease.
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { describe, test } from 'vitest';

import type { ToPage } from '../src/protocol.ts';
import { createRelay } from '../src/relay.ts';
import { rig } from './fixture.ts';
import { serve, socket } from './sockets.ts';

const LEAD = 8;

/** A sender on `page`: hello, then frames LEAD ahead of the injected slot clock. */
async function sender(page: string) {
  const c = await socket(page);
  c.send({ type: 'hello' });
  await c.next('hello');
  let sent = -1;
  const pump = async (now: number, rev: number) => {
    for (let i = Math.max(sent + 1, now + 1); i <= now + LEAD; i++) {
      const b = new Uint8Array(8 + rig.count * 6), v = new DataView(b.buffer);
      v.setUint32(0, i, true);
      v.setUint32(4, rev, true);
      for (let k = 0; k < rig.count * 3; k++) v.setUint16(8 + k * 2, 20000, true);
      c.ws.send(b);
      sent = i;
    }
    // A pong is ordered after these frames: the server has consumed them before the next engine tick.
    const pong = once(c.ws, 'pong');
    c.ws.ping();
    await pong;
  };
  return { ...c, pump,
    relay: async (from = c.got.length) => (await c.next('relay', from)) as Extract<ToPage, { type: 'relay' }> };
}

describe('relay over the socket', () => {
  test('a jittery sender plays, a gap falls back and recovers, a second sender is refused', async () => {
    const clock = { t: 0 };
    const relay = createRelay({ count: rig.count, fps: 40, now: () => clock.t });
    const x = await serve('', clock, '', 'live', relay);
    const a = await sender(x.page);
    let nextSend = 0, jitter = 0;
    const run = async (ms: number, sending = true) => {
      for (const end = clock.t + ms; clock.t < end; clock.t += 25) {
        if (sending && clock.t >= nextSend) {
          await a.pump(x.engine.stats.frames + x.engine.stats.late, x.engine.state().look!.rev);
          nextSend = clock.t + [5, 45, 15, 35][jitter++ % 4]!;
        }
        x.engine.tick();
      }
    };
    let from = a.got.length;
    a.send({ type: 'relay-start' });
    assert.deepEqual(await a.relay(from), { type: 'relay', holding: true });
    await run(1500);
    assert.equal(relay.state()?.on, true);
    assert.equal(relay.state()!.misses, 1, 'only the slot already playing when the sender starts is missed');

    // A second sender: refused, saying who; its binary refused too.
    const b = await sender(x.page);
    from = b.got.length;
    b.send({ type: 'relay-start' });
    assert.deepEqual(await b.relay(from), { type: 'relay', holding: false,
      error: 'the Pi\'s page is relaying to the lights.' });
    from = b.got.length;
    b.ws.send(new Uint8Array(8 + rig.count * 6));
    assert.match(JSON.stringify(await b.next('error', from)), /relay-start/);

    // A gap of 400 ms: the engine dips to its own render, and a second of steady frames brings the relay back.
    await run(400, false);
    assert.equal(relay.state()?.on, false);
    await run(1600);
    assert.equal(relay.state()?.on, true);

    // Closing frees the lease for the next.
    a.ws.close();
    await once(a.ws, 'close');
    assert.equal(relay.state(), null);
    from = b.got.length;
    b.send({ type: 'relay-start' });
    assert.equal((await b.relay(from)).holding, true);
  }, 15_000);
});
