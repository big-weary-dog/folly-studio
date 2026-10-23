// DDP: a frame out as fppd takes it (1,440-byte packets, PUSH on the last) and back through the simulator's receiver.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';

import { test, vi } from 'vitest';

import { ddpPackets, ddpReceiver, ddpSender } from '../src/ddp.ts';

test('an output socket error rejects readiness so startup can clean up', async () => {
  const socket = Object.assign(new EventEmitter(), {
    connect: () => queueMicrotask(() => socket.emit('error', new Error('injected connect failure'))),
    close: (done: () => void) => done(),
  });
  const mock = vi.spyOn(dgram, 'createSocket').mockReturnValue(socket as unknown as dgram.Socket);
  try {
    const tx = ddpSender({ channels: 3 });
    await assert.rejects(tx.ready, /injected connect failure/);
    assert.equal(tx.status().errors, 1);
    assert.equal(tx.send(new Uint8Array(3)), false);
    await tx.close();
  } finally { mock.mockRestore(); }
});

test('a 70,401-channel frame: 49 packets, offsets and lengths in order, PUSH on the last only', () => {
  const { packets, fill } = ddpPackets(70401), frame = new Uint8Array(70401).map((_, i) => i % 256);
  fill(frame, 7);
  assert.equal(packets.length, 49);
  let at = 0;
  for (const [i, p] of packets.entries()) {
    assert.equal(p[0], i === 48 ? 0x41 : 0x40);
    assert.deepEqual([p[1], p[2], p[3]], [7, 1, 1]);
    assert.equal(p.readUInt32BE(4), at);
    assert.equal(p.readUInt16BE(8), p.length - 10);
    assert.deepEqual(p.subarray(10), Buffer.from(frame.subarray(at, at + p.length - 10)));
    at += p.length - 10;
  }
  assert.equal(at, 70401);
  // Another frame, or the same one changed, fills them anew.
  const other = new Uint8Array(70401).fill(9);
  fill(other, 8);
  assert.ok(packets.every((p) => p[1] === 8 && p.subarray(10).every((v) => v === 9)));
  frame.fill(3);
  fill(frame, 9);
  assert.ok(packets.every((p) => p.subarray(10).every((v) => v === 3)));
});

test('sent over UDP, received whole', async () => {
  const channels = 5000, frames: Uint8Array[] = [];
  let got: () => void;
  const done = new Promise<void>((resolve) => { got = resolve; });
  const rx = ddpReceiver({ port: 0, channels, onFrame: (f) => {
    frames.push(f.slice());
    if (frames.length === 2) got();
  } });
  const port = await rx.ready, tx = ddpSender({ port, channels });
  await tx.ready;
  const a = new Uint8Array(channels).fill(200), b = new Uint8Array(channels).map((_, i) => i & 255);
  tx.send(a);
  tx.send(b);
  await done;
  assert.deepEqual(frames, [a, b]);
  assert.equal(tx.status().errors, 0);
  await Promise.all([tx.close(), rx.close()]);
});
