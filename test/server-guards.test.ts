// The server's guards against a rough host and bad luck: clocks that never step back, one reading of on/off settings,
// a stage socket that outlives a failing message, a cap on password hashes running at once.
import assert from 'node:assert/strict';

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, test, vi } from 'vitest';

import { createAuth } from '../src/auth.ts';
import { monoNow, serverNow } from '../src/clock.ts';
import { envFlag } from '../src/env.ts';
import { createHub } from '../src/live/hub.ts';

describe('clock', () => {
  test('monoNow and serverNow ignore a wall clock that steps back', () => {
    const [mono, server] = [monoNow(), serverNow()];
    const wall = vi.spyOn(Date, 'now').mockReturnValue(server - 60_000);
    try {
      assert.ok(Number.isInteger(monoNow()) && monoNow() >= mono);
      assert.ok(serverNow() >= server && serverNow() - server < 1000);
    } finally { wall.mockRestore(); }
  });
});

describe('envFlag', () => {
  test('1, true, on and yes in any case are on; anything else is off', () => {
    for (const v of ['1', 'true', 'TRUE', 'on', 'On', 'yes', ' YES ']) assert.equal(envFlag(v), true, v);
    for (const v of [undefined, '', '0', 'false', 'off', 'no', 'enabled', '2']) assert.equal(envFlag(v), false, v);
  });
});

describe('live hub', () => {
  test('a message that throws is logged and answered, and the socket plays on', async () => {
    const errors: unknown[] = [];
    const hub = await createHub({ dataDir: await mkdtemp(path.join(tmpdir(), 'hub-')),
      playable: () => { throw new Error('store down'); }, log: { error: (...a: unknown[]) => errors.push(a) } });
    const handlers: Record<string, (data: unknown) => void> = {}, sent: { type: string, error?: string }[] = [];
    const ws = { readyState: 1, bufferedAmount: 0, on: (e: string, fn: (d: unknown) => void) => { handlers[e] = fn; },
      send: (t: string) => sent.push(JSON.parse(t)), ping() {}, close() {}, terminate() {} };
    try {
      hub.join(ws as never, { id: 'u1', username: 'ada' }, true);
      handlers.message!(JSON.stringify({ type: 'play', lookId: 'abc' }));
      assert.equal(errors.length, 1);
      assert.equal(sent.at(-1)?.type, 'error');
      handlers.message!(JSON.stringify({ type: 'ping', id: 1 }));
      assert.equal(sent.at(-1)?.type, 'pong');
    } finally { await hub.close(); }
  });
});

describe('password hashing', () => {
  test('at most `slots` run at once, `queue` wait, and past that 429', async () => {
    const users: { id: string, username: string }[] = [];
    const store = { users: { list: (f: (u: unknown) => boolean) => users.filter(f),
      create: (u: { username: string }) => { const x = { ...u, id: u.username }; users.push(x); return x; } } };
    const auth = createAuth({ store: store as never, cost: { N: 2 ** 10, r: 8, p: 1 }, slots: 1, queue: 1 });
    const tries = await Promise.allSettled(['a', 'b', 'c'].map((username) => auth.signup({ username,
      password: 'long enough' })));
    assert.deepEqual(tries.map((t) => t.status), ['fulfilled', 'fulfilled', 'rejected']);
    assert.equal((tries[2] as PromiseRejectedResult).reason.status, 429);
    await auth.signup({ username: 'd', password: 'long enough' });
    assert.equal(users.length, 3, 'the slot came back');
  });
});
