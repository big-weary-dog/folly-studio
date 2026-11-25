// The server's guards against a rough host and bad luck: clocks that never step back, a cap on password hashes
// running at once.
import assert from 'node:assert/strict';

import { describe, test, vi } from 'vitest';

import { createAuth } from '../src/auth.ts';
import { monoNow } from '../src/clock.ts';

describe('clock', () => {
  test('monoNow ignores a wall clock that steps back', () => {
    const mono = monoNow();
    const wall = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 60_000);
    try {
      assert.ok(Number.isInteger(monoNow()) && monoNow() >= mono);
    } finally { wall.mockRestore(); }
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
