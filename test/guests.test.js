// Guests (spec/http "Guests"): a session with a name and no account, which only reads, is nobody's admin whatever
// its name, sees no AI, and is let back in by its cookie.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { createAuth } from '../src/auth.ts';
import { client, signup } from './fixtures/app.js';
import { startApp, useFixture } from './fixtures/server.js';

useFixture();

describe('guests', () => {
  let app, owner, shared;
  beforeAll(async () => {
    app = await startApp({ admins: 'ada', rateLimit: { guestMax: 50 },
      dataDir: mkdtempSync(path.join(tmpdir(), 'guests-')) });
    owner = await signup(app, 'bob');
    const r = await owner.post('/api/looks', { title: 'Embers', layers: [], shared: true });
    assert.equal(r.status, 201, r.text);
    shared = r.json.look.id;
    app.store.looks.update(shared, { reviewed: true });   // approved: in the gallery for everyone
  });
  afterAll(() => app?.close());
  const guest = async (name) => {
    const c = client(app), r = await c.post('/api/guest', { name });
    assert.equal(r.status, 201, r.text);
    return Object.assign(c, { user: r.json.user });
  };

  test('in by a name alone: a member, never stored, and back in by the cookie', async () => {
    const g = await guest('  Ada  ');
    assert.equal(g.user.username, 'Ada');
    assert.equal(g.user.role, 'member');
    assert.equal(g.user.guest, true);
    assert.match(g.user.id, /^guest-/);
    const me = await g.get('/api/me');
    assert.equal(me.status, 200);
    assert.deepEqual(me.json.user, g.user);
    assert.equal(me.json.access, undefined, 'no AI for a guest');
    assert.equal(app.store.users.list().length, 1, 'only bob is an account');
  });

  test('Try it sends no name: a guest named Visitor', async () => {
    const r = await client(app).post('/api/guest', {});
    assert.equal(r.status, 201, r.text);
    assert.deepEqual([r.json.user.username, r.json.user.guest], ['Visitor', true]);
  });

  test('a visitor, with no session, reads approved looks alone; anything else asks them to log in', async () => {
    const hid = (await owner.post('/api/looks', { title: 'Mine', layers: [], shared: true })).json.look.id;
    const v = client(app), gallery = await v.get('/api/looks?scope=gallery');
    assert.equal(gallery.status, 200, gallery.text);
    assert.deepEqual(gallery.json.looks.map((l) => l.id), [shared], 'the approved one, not the one waiting');
    assert.equal((await v.get(`/api/looks/${shared}`)).json.look.title, 'Embers');
    for (const url of [`/api/looks/${hid}`, `/api/looks/${shared}/frames`, `/api/looks/${shared}/frames/wire`,
      `/api/looks/${hid}/frames`, `/api/looks/${shared}/preview/x.webp`]) {
      assert.equal((await v.get(url)).status, 404, url);   // never 401: unbaked, or not theirs to see
    }
    assert.equal((await v.get('/api/light')).status, 200);
    assert.equal((await v.get('/api/me')).json.user, null, 'nobody signed in, said so');
    for (const url of ['/api/looks?scope=mine', `/api/looks/${shared}/versions`]) {
      assert.equal((await v.get(url)).status, 401, url);
    }
    assert.equal((await v.put(`/api/looks/${shared}`, { title: 'Ours' })).status, 401);
  });

  test('reads the gallery and the library; every write is refused, signing out is not', async () => {
    const g = await guest('Wren');
    assert.equal((await g.get(`/api/looks/${shared}`)).status, 200);
    assert.equal((await g.get('/api/library')).status, 200);
    const writes = [['POST', '/api/looks', { title: 'Mine', layers: [] }], ['PUT', `/api/looks/${shared}`, {}],
      ['PUT', '/api/me/tour', { seen: true, done: [] }], ['POST', `/api/looks/${shared}/bake`, {}],
      ['DELETE', `/api/looks/${shared}`]];
    for (const [method, url, body] of writes) {
      const r = await g.req(method, url, body);
      assert.equal(r.status, 403, `${method} ${url}: ${r.text}`);
      assert.match(r.json.error, /Guests can't save/);
    }
    assert.equal((await g.post('/api/logout', {})).status, 200);
    assert.equal((await g.get('/api/me')).json.user, null);
  });

  test('the name is checked, and guests are limited per address', async () => {
    for (const name of ['', ' ', 'x'.repeat(25), 'a<b>', 'tab\there', 'rtl‮override', 42]) {
      const r = await client(app).post('/api/guest', { name });
      assert.equal(r.status, 400, JSON.stringify(name));
    }
    const few = await startApp({ rateLimit: { guestMax: 2 }, dataDir: mkdtempSync(path.join(tmpdir(), 'guests-')) });
    try {
      const codes = [];
      for (let i = 0; i < 3; i++) codes.push((await client(few).post('/api/guest', { name: 'Many' })).status);
      assert.deepEqual(codes, [201, 201, 429]);
    } finally { await few.close(); }
  });

  test('guest sessions last 7 days, and past the cap the oldest go first; an account\'s are untouched', () => {
    const docs = new Map(), ada = { id: 'u1', username: 'ada', passwordHash: '' };
    let n = 0;
    const sessions = { get: (id) => docs.get(id) ?? null, list: (f = () => true) => [...docs.values()].filter(f),
      create: (x) => { const d = { ...x, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n++)).toISOString() };
        docs.set(x.id, d); return d; },
      update: () => null, remove: (id) => docs.delete(id) };
    const auth = createAuth({ store: { users: { get: (id) => (id === ada.id ? ada : null) }, sessions }, guests: 3 });
    const mine = auth.createSession(ada);
    const tokens = ['A', 'B', 'C', 'D', 'E'].map((name) => auth.createSession(auth.guest(name)));
    assert.deepEqual(tokens.map((t) => auth.authenticate(t)?.user.username ?? null), [null, null, 'C', 'D', 'E']);
    assert.equal(auth.authenticate(mine)?.user.username, 'ada');
    const left = Date.parse(auth.authenticate(tokens[4]).session.expiresAt) - Date.now();
    assert.ok(left > 6.9 * 864e5 && left <= 7 * 864e5, `${left}`);
  });
});
