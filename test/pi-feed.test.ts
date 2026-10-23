// A temporary PIN lockout must not strand Studio's feed on an unauthenticated socket.
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { test, vi } from 'vitest';
import { WebSocketServer } from 'ws';

import { piFeed } from '../src/live/pi-feed.ts';

test('rejected hellos reconnect with backoff; only acceptance resets it and sends the current mode', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const attempts: number[] = [], modes: string[] = [], warnings: unknown[][] = [];
  let mode: 'jukebox' | 'live' = 'jukebox';
  let accepted!: () => void, timeout: NodeJS.Timeout;
  const ready = new Promise<void>((resolve, reject) => {
    accepted = resolve;
    timeout = setTimeout(() => reject(new Error('the feed never recovered after rejected hellos')), 20_000);
  });
  server.on('connection', (ws) => ws.on('message', (d) => {
    const msg = JSON.parse(String(d));
    if (msg.type === 'hello') {
      attempts.push(performance.now());
      assert.equal(msg.feed, true);
      const ok = attempts.length >= 3;
      ws.send(JSON.stringify({ type: 'hello', ok, ...ok ? {} : { error: 'Too many wrong PINs: wait a minute.' } }));
      if (!ok) mode = 'live';
    } else if (msg.type === 'mode') {
      if (attempts.length < 3) return; // a locked engine ignores controls until it accepts a hello
      modes.push(msg.mode);
      if (modes.length === 1) ws.close(); // after acceptance, reconnect should take only the initial wait
      else accepted();
    }
  }));
  const timers = vi.spyOn(globalThis, 'setTimeout');
  const feed = piFeed({ target: new URL(`http://127.0.0.1:${address.port}`), pin: 'test-pin', mode: () => mode,
    onNow: () => {}, onSource: () => {}, log: { warn: (...a) => warnings.push(a) } });
  try {
    await ready;
    assert.equal(feed.connected(), true);
    assert.equal(attempts.length, 4);
    assert.deepEqual(timers.mock.calls.filter(([fn]) => fn.name === 'connect').map(([, ms]) => ms),
      [1000, 2000, 1000], 'only an accepted hello resets the backoff');
    assert.deepEqual(modes, ['live', 'live']);
    assert.equal(warnings.length, 2);
  } finally {
    clearTimeout(timeout!);
    timers.mockRestore();
    feed.close();
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>((r) => server.close(() => r()));
  }
}, 30_000);
