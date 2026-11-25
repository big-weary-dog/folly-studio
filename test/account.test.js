// An account's own settings (SPEC-access "Your account"): a new password, and the account deleted with its looks.
import assert from 'node:assert/strict';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { createAuth } from '../src/auth.ts';
import { createStore } from '../src/store.ts';
import { client, fx, layer, quiet, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();

describe('your account', () => {
  let app;
  beforeAll(async () => {
    app = await startApp({ dataDir: path.join(fx.tmp, 'data-account'), rateLimit: { max: 3 } });
  });
  afterAll(() => app.close());

  const login = async (username, password) => {
    const c = client(app);
    return [c, (await c.post('/api/login', { username, password })).status];
  };

  test('a new password needs the current one; it ends the other sessions and keeps this one', async () => {
    const ann = await signup(app, 'acct-ann');
    const [other] = await login('acct-ann', 'correct horse');
    const wrong = await ann.put('/api/me/password', { password: 'not it', next: 'battery staple' });
    assert.deepEqual([wrong.status, wrong.json.error], [403, 'That is not your password.']);
    const short = await ann.put('/api/me/password', { password: 'correct horse', next: 'short' });
    assert.deepEqual([short.status, short.json.error], [400, 'Password must be at least 8 characters.']);
    assert.equal((await ann.put('/api/me/password', { password: 'correct horse', next: 'battery staple' })).status,
      200);
    assert.equal((await ann.get('/api/me')).status, 200, 'this session stays');
    assert.equal((await other.get('/api/me')).status, 401, 'the other ended');
    assert.equal((await login('acct-ann', 'correct horse'))[1], 401);
    assert.equal((await login('acct-ann', 'battery staple'))[1], 200);
  });

  test('of two changes at once, one stands', async () => {
    const [ivy] = [await signup(app, 'acct-ivy')], [twin] = await login('acct-ivy', 'correct horse');
    const both = await Promise.all([['battery staple', ivy], ['staple battery', twin]].map(([next, c]) =>
      c.put('/api/me/password', { password: 'correct horse', next }).then((r) => [r.status, next])));
    const won = both.filter(([status]) => status === 200);
    assert.equal(won.length, 1, JSON.stringify(both));
    assert.equal((await login('acct-ivy', won[0][1]))[1], 200);
    assert.equal((await login('acct-ivy', both.find((b) => b !== won[0])[1]))[1], 401);
  });

  test('a password checked against an account read before it changed is 409, as is one from an ended session',
    async () => {
      const store = createStore(path.join(fx.tmp, 'data-account-auth'), { log: quiet });
      const auth = createAuth({ store: await store, cost: { N: 1024, r: 8, p: 1 } });
      const old = await auth.signup({ username: 'jo', password: 'correct horse' });
      const [a, b] = [auth.createSession(old), auth.createSession(old)];
      await auth.changePassword(old, { password: 'correct horse', next: 'battery staple' }, a);
      const stale = auth.confirm(old, 'correct horse', b);   // a deletion begun before the change landed
      await assert.rejects(stale, { status: 409 });
      const now = (await store).users.get(old.id);
      await assert.rejects(auth.confirm(now, 'battery staple', b), { status: 409 }, 'b was signed out');
      await auth.confirm(now, 'battery staple', a);
    });

  test('wrong passwords are limited per account: 429 with Retry-After, even for the right one', async () => {
    const bo = await signup(app, 'acct-bo');
    for (let n = 0; n < 3; n++) assert.equal((await bo.del('/api/me', { password: 'nope' })).status, 403);
    const over = await bo.put('/api/me/password', { password: 'correct horse', next: 'battery staple' });
    assert.equal(over.status, 429);
    assert.ok(Number(over.headers.get('retry-after')) > 0);
    const cy = await signup(app, 'acct-cy');
    assert.equal((await cy.del('/api/me', { password: 'nope' })).status, 403, 'another account has its own');
  });

  test('deleting the account takes its looks, shared ones too, and signs it out; others\' looks stay', async () => {
    const dee = await signup(app, 'acct-dee'), eve = await signup(app, 'acct-eve');
    const mine = (await dee.post('/api/looks', { title: 'Mine', layers: [layer()] })).json.look;
    const shared = (await dee.post('/api/looks', { title: 'Shared', layers: [layer()], shared: true })).json.look;
    const copy = (await eve.post('/api/looks', { title: 'Shared', layers: [layer()] })).json.look;
    const gone = await dee.del('/api/me', { password: 'correct horse' });
    assert.equal(gone.status, 200);
    assert.ok(gone.setCookie.some((c) => c.startsWith('studio_session=;')));
    assert.equal((await dee.get('/api/me')).status, 401);
    assert.equal((await login('acct-dee', 'correct horse'))[1], 401);
    for (const id of [mine.id, shared.id]) assert.equal((await eve.get(`/api/looks/${id}`)).status, 404);
    const gallery = (await eve.get('/api/looks?scope=gallery')).json.looks.map((l) => l.id);
    assert.equal(gallery.includes(shared.id), false);
    assert.equal((await eve.get(`/api/looks/${copy.id}`)).status, 200);
    await signup(app, 'acct-dee');   // the name is free again
  });

  test('a guest has no account to change', async () => {
    const guest = client(app);
    await guest.post('/api/guest', { name: 'Visitor' });
    assert.equal((await guest.del('/api/me', { password: 'x' })).status, 403);
  });
});
