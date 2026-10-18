// Passwords and the proxy in front: scrypt at OWASP's cost, hashes that carry their own parameters (one made at an
// older cost logs in and is made again at the current one), and what a trusted tunnel's X-Forwarded-* may decide.
import assert from 'node:assert/strict';
import path from 'node:path';

import { describe, test } from 'vitest';

import { costOf, hashPassword, SCRYPT, verifyPassword, weaker } from '../src/auth.ts';
import { client, fx, startApp, useFixture } from './fixtures/server.js';

useFixture();
const OLD = { N: 2 ** 14, r: 8, p: 1 };   // the cost hashes were made at before
const data = (name: string) => path.join((fx as { tmp: string }).tmp, name);

describe('passwords', () => {
  test("scrypt at OWASP's minimum, each hash naming its cost", async () => {
    assert.deepEqual({ ...SCRYPT }, { N: 2 ** 17, r: 8, p: 1 });
    const hash = await hashPassword('correct horse');
    assert.match(hash, /^scrypt\$131072\$8\$1\$[\w-]{22}\$[\w-]{86}$/);
    assert.deepEqual(costOf(hash), SCRYPT);
    assert.equal(await verifyPassword('correct horse', hash), true);
    assert.equal(await verifyPassword('correct horsE', hash), false);
    assert.equal(weaker(hash, SCRYPT), false);
    const old = await hashPassword('correct horse', OLD);
    assert.equal(await verifyPassword('correct horse', old), true, 'an older cost still verifies');
    assert.equal(weaker(old, SCRYPT), true);
    const absurd = `scrypt$${2 ** 21}$8$1$c2FsdA$a2V5`;
    for (const bad of ['', 'bcrypt$2b$x', absurd, 'scrypt$16384$8$1$$', 'scrypt$x$8$1$a$b']) {
      assert.equal(await verifyPassword('correct horse', bad), false, bad);
    }
  });

  test('a hash at an older cost logs in, and the login makes it again at the current one', async () => {
    const app = await startApp({ dataDir: data('data-rehash'), scrypt: SCRYPT });
    try {
      const old = await hashPassword('correct horse', OLD);
      const { id } = app.store.users.create({ username: 'old-timer', passwordHash: old });
      const login = (password: string) => client(app).post('/api/login', { username: 'old-timer', password });
      assert.equal((await login('wrong horse')).status, 401);
      assert.equal(app.store.users.get(id)!.passwordHash, old, 'a failed login changes nothing');
      assert.equal((await login('correct horse')).status, 200);
      const now = app.store.users.get(id)!.passwordHash;
      assert.deepEqual(costOf(now), SCRYPT);
      assert.equal((await login('correct horse')).status, 200, 'and it logs in with the new hash');
      assert.equal(app.store.users.get(id)!.passwordHash, now, 'made again once');
    } finally {
      await app.close();
    }
  });
});

describe('behind the tunnel (trustProxy)', () => {
  test("the client is X-Forwarded-For's right-most address: one forged to its left changes nothing", async () => {
    const app = await startApp({ dataDir: data('data-proxy'), trustProxy: true, rateLimit: { ipMax: 3 } });
    try {
      const login = (xff: string) => client(app).post('/api/login', { username: 'nobody', password: 'wrong horse' },
        { 'x-forwarded-for': xff });
      for (const xff of ['9.9.9.9', '6.6.6.6, 9.9.9.9', '127.0.0.1, 9.9.9.9']) {
        assert.equal((await login(xff)).status, 401, xff);
      }
      const blocked = await login('7.7.7.7, 9.9.9.9');
      assert.equal(blocked.status, 429, 'the same client, whatever it put on the left');
      assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
      assert.equal((await login('8.8.8.8')).status, 401, 'another client has its own limit');
      // The tunnel's host is the one a same-origin check compares with.
      const origin = { origin: 'https://studio.example.org', 'x-forwarded-host': 'studio.example.org' };
      assert.equal((await client(app).post('/api/login', { username: 'nobody' }, origin)).status, 401);
    } finally {
      await app.close();
    }
  });

  test('without it, X-Forwarded-* is ignored', async () => {
    const app = await startApp({ dataDir: data('data-direct'), rateLimit: { ipMax: 2 } });
    try {
      const login = (xff: string) => client(app).post('/api/login', { username: 'nobody', password: 'wrong horse' },
        { 'x-forwarded-for': xff });
      assert.equal((await login('1.1.1.1')).status, 401);
      assert.equal((await login('2.2.2.2')).status, 401);
      assert.equal((await login('3.3.3.3')).status, 429, 'every one of these came from 127.0.0.1');
      const origin = { origin: 'https://studio.example.org', 'x-forwarded-host': 'studio.example.org' };
      assert.equal((await client(app).post('/api/logout', {}, origin)).status, 403);
    } finally {
      await app.close();
    }
  });
});
