// A temporary PIN lockout must not strand Studio's feed on an unauthenticated socket.
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { test, vi } from 'vitest';
import { WebSocketServer } from 'ws';

import { piFeed } from '../src/live/pi-feed.ts';

test('concurrent sends wait for their own acknowledgement; disconnect and timeout never succeed', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const messages: { requestId: string }[] = [];
  let socket!: import('ws').WebSocket;
  let ready!: () => void, received!: () => void;
  const connected = new Promise<void>((resolve) => { ready = resolve; });
  let arrived = new Promise<void>((resolve) => { received = resolve; });
  server.on('connection', (ws) => {
    socket = ws;
    ws.on('message', (d) => {
      const msg = JSON.parse(String(d));
      if (msg.type === 'hello') ws.send(JSON.stringify({ type: 'hello', ok: true }));
      if (msg.type === 'mode') ready();
      if (msg.type === 'send') { messages.push(msg); received(); }
    });
  });
  const feed = piFeed({ target: new URL(`http://127.0.0.1:${address.port}`),
    onNow: () => {}, onSource: () => {} });
  try {
    await connected;
    let firstSettled = false;
    const first = feed.send({ type: 'send' }).then((result) => { firstSettled = true; return result; });
    await arrived;
    arrived = new Promise<void>((resolve) => { received = resolve; });
    const second = feed.send({ type: 'send' });
    await arrived;
    assert.notEqual(messages[0].requestId, messages[1].requestId);
    socket.send(JSON.stringify({ type: 'sent', requestId: 'unrelated', ok: true }));
    socket.send(JSON.stringify({ type: 'sent', requestId: messages[1].requestId, ok: false, error: 'Full.' }));
    assert.deepEqual(await second, { ok: false, status: 409, error: 'Full.' });
    assert.equal(firstSettled, false, 'neither an unrelated reply nor another request settles the first send');
    socket.send(JSON.stringify({ type: 'sent', requestId: messages[0].requestId, ok: true }));
    assert.deepEqual(await first, { ok: true });
    const missing = feed.send({ type: 'send' });
    assert.match((await missing as { error: string }).error, /did not acknowledge/);
    const disconnected = feed.send({ type: 'send' });
    socket.close();
    assert.match((await disconnected as { error: string }).error, /disconnected/);
  } finally {
    feed.close();
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 10_000);

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
