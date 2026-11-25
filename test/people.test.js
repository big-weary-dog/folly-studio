// People (spec/http "People"): admins list accounts, change roles, disable and delete them.
import assert from 'node:assert/strict';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { lookRoutes } from '../src/api-looks.ts';
import { createAuth } from '../src/auth.ts';
import { removeAccount } from '../src/account-removal.ts';
import { createStore } from '../src/store.ts';
import { CHEAP_SCRYPT, client, signup } from './fixtures/app.js';
import { quiet } from './fixtures/quiet.js';
import { fx, layer, startApp, useFixture } from './fixtures/server.js';

useFixture();

describe('people', () => {
  let app, ada, cat;
  beforeAll(async () => {
    app = await startApp({ dataDir: path.join(fx.tmp, 'data-people'), admins: 'ada', curators: 'cat' });
    ada = await signup(app, 'ada');
    cat = await signup(app, 'cat');
  });
  afterAll(() => app.close());
  const accounts = async () => (await ada.get('/api/admin/accounts')).json.accounts;
  const login = async (username, password = 'correct horse') => (await client(app).post('/api/login',
    { username, password })).status;

  test('only admins see People; it lists each account with its role, looks and shared looks', async () => {
    const bea = await signup(app, 'bea');
    await bea.post('/api/looks', { title: 'Mine', layers: [layer()] });
    await bea.post('/api/looks', { title: 'Ours', layers: [layer()], shared: true });
    assert.equal((await bea.get('/api/admin/accounts')).status, 403);
    assert.equal((await cat.get('/api/admin/accounts')).status, 403, 'curators too');
    const list = await accounts();
    assert.deepEqual(list.map((a) => a.username).slice(0, 3), ['bea', 'cat', 'ada'], 'newest first');
    const b = list.find((a) => a.username === 'bea');
    assert.deepEqual({ ...b, id: 0, createdAt: 0 }, { id: 0, createdAt: 0, username: 'bea', role: 'member',
      looks: 2, shared: 1, disabled: false });
    assert.equal(list.find((a) => a.username === 'cat').serverRole, 'curator');
  });

  test('a role is kept with the account; the server\'s lists still count', async () => {
    const dot = await signup(app, 'dot');
    const made = await ada.put(`/api/admin/accounts/${dot.user.id}`, { role: 'curator' });
    assert.deepEqual([made.status, made.json.account.role], [200, 'curator']);
    assert.equal((await dot.get('/api/me')).json.user.role, 'curator');
    assert.equal((await dot.get('/api/admin/accounts')).status, 403);
    await ada.put(`/api/admin/accounts/${dot.user.id}`, { role: 'admin' });
    assert.equal((await dot.get('/api/admin/accounts')).status, 200);
    const lower = await ada.put(`/api/admin/accounts/${cat.user.id}`, { role: 'member' });
    assert.deepEqual([lower.status, lower.json.error], [409,
      'cat is a curator by the server\'s settings: change those instead.']);
    assert.equal((await ada.put(`/api/admin/accounts/${cat.user.id}`, { role: 'admin' })).json.account.role, 'admin');
    assert.equal((await ada.put(`/api/admin/accounts/${dot.user.id}`, { role: 'boss' })).status, 400);
  });

  test('a disabled account is signed out and cannot sign in until it is enabled', async () => {
    const eve = await signup(app, 'eve');
    const off = await ada.put(`/api/admin/accounts/${eve.user.id}`, { disabled: true });
    assert.equal(off.json.account.disabled, true);
    assert.equal((await eve.get('/api/me')).json.user, null);
    assert.equal(await login('eve'), 403);
    assert.equal(await login('eve', 'wrong horse'), 401, 'a wrong password says nothing of it');
    await ada.put(`/api/admin/accounts/${eve.user.id}`, { disabled: false });
    assert.equal(await login('eve'), 200);
  });

  test('an account disabled while its password is checked does not sign in', async () => {
    const store = await createStore(path.join(fx.tmp, 'data-people-login'), { log: quiet });
    const auth = createAuth({ store, cost: CHEAP_SCRYPT });
    const { id } = await auth.signup({ username: 'gus', password: 'correct horse' });
    const late = auth.login({ username: 'gus', password: 'correct horse' });   // checking the password
    auth.setAccount(id, { disabled: true });
    await assert.rejects(late, { status: 403 });
  });

  test('a look being saved as its account is deleted is not kept', async () => {
    const store = await createStore(path.join(fx.tmp, 'data-people-save'), { log: quiet });
    const auth = createAuth({ store, cost: CHEAP_SCRYPT });
    let open;
    const gate = new Promise((resolve) => { open = resolve; });
    const { routes } = lookRoutes({ store, auth, bakes: {}, dropFrames: async () => {},
      codeGate: { check: () => gate } });
    const user = await auth.signup({ username: 'hal', password: 'correct horse' });
    const save = routes['POST /looks']({ user, body: { title: 'Late', layers: [layer()], shared: true } },
      { code() {} });
    await removeAccount({ store, auth, dropFrames: async () => {} }, user.id);
    open();
    await assert.rejects(save, { status: 401 });
    assert.equal(store.looks.count((l) => l.owner === user.id), 0);
  });

  test('deleting takes the account and its looks; an admin changes nothing of their own', async () => {
    const fay = await signup(app, 'fay');
    const look = (await fay.post('/api/looks', { title: 'Gone', layers: [layer()], shared: true })).json.look;
    assert.equal((await ada.del(`/api/admin/accounts/${fay.user.id}`)).status, 200);
    assert.equal((await fay.get('/api/me')).json.user, null);
    assert.equal((await ada.get(`/api/looks/${look.id}`)).status, 404);
    assert.equal((await accounts()).some((a) => a.username === 'fay'), false);
    assert.equal((await ada.del(`/api/admin/accounts/${fay.user.id}`)).status, 404);
    for (const r of [await ada.put(`/api/admin/accounts/${ada.user.id}`, { disabled: true }),
      await ada.del(`/api/admin/accounts/${ada.user.id}`)]) assert.equal(r.status, 409);
    assert.equal((await ada.get('/api/me')).status, 200);
  });
});
