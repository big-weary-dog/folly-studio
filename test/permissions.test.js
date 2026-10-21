// Who may do what (shared/policy.ts), and the routes that need a role: every /admin route declares one, or the
// server does not start (http.ts's adminsDeclared); a member is refused each, and no session is asked to log in.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { can } from '../shared/policy.ts';
import { adminsDeclared } from '../src/http.ts';
import { signup, startApp, useFixture } from './fixtures/server.js';

useFixture();

describe('can', () => {
  const [member, curator, admin] = ['member', 'curator', 'admin'].map((role) => ({ id: role, role }));
  const mine = { owner: 'member' }, shared = { owner: 'other', shared: true }, hidden = { owner: 'other' };

  test('roles: admin above curator above member; nobody signed in may do nothing', () => {
    assert.deepEqual([member, curator, admin].map((u) => can(u, 'admin')), [false, false, true]);
    assert.deepEqual([member, curator, admin].map((u) => can(u, 'curate')), [false, true, true]);
    for (const action of ['admin', 'curate', 'see', 'edit', 'delete', 'bake']) {
      assert.equal(can(null, action, mine), false);
    }
  });

  test('looks: the owner does anything; others see a shared one; a curator reviews and bakes what they see', () => {
    const table = (u) => ['see', 'edit', 'review', 'bake'].map((a) => [mine, shared, hidden].map((l) => can(u, a, l)));
    assert.deepEqual(table(member), [[true, true, false], [true, false, false], [false, false, false],
      [true, false, false]]);
    assert.deepEqual(table(curator), [[false, true, false], [false, false, false], [false, true, false],
      [false, true, false]]);
    assert.equal(can(member, 'edit'), true, 'a new look is theirs');
  });

  test('delete: the owner their own; an admin any shared look, never an unshared one', () => {
    const row = (u) => [mine, shared, hidden].map((l) => can(u, 'delete', l));
    assert.deepEqual([member, curator, admin].map(row), [[true, false, false], [false, false, false],
      [false, true, false]]);
  });
});

describe('routes that need a role', () => {
  test('an /admin route that names no role stops the server at start', () => {
    assert.throws(() => adminsDeclared({ method: 'GET', url: '/api/admin/things' }), /needs a role/);
    assert.throws(() => adminsDeclared({ method: 'GET', url: '/admin', config: {} }), /needs a role/);
    adminsDeclared({ method: 'GET', url: '/api/admin/things', config: { role: 'admin' } });
    adminsDeclared({ method: 'PUT', url: '/api/admin/things', config: { public: true } }); // a 405
    adminsDeclared({ method: 'GET', url: '/api/administer' });
  });

  let app, member, admin, curator;
  beforeAll(async () => {
    app = await startApp({ admins: 'ada', curators: 'cat', dataDir: mkdtempSync(path.join(tmpdir(), 'permissions-')) });
    [admin, member, curator] = [await signup(app, 'ada'), await signup(app, 'bob'), await signup(app, 'cat')];
  });
  afterAll(() => app?.close());

  const ADMIN = ['GET /api/admin/models', 'PUT /api/admin/models', 'PUT /api/admin/light', 'GET /api/admin/invites',
    'POST /api/admin/invites', 'DELETE /api/admin/invites/x', 'GET /api/admin/people', 'PUT /api/admin/people/x',
    'GET /api/admin/reports', 'GET /api/admin/reports/x', 'GET /api/admin/reports/x/shot',
    'GET /api/admin/ideas/x/log', 'GET /api/admin/ideas/x/log/stills/x.png'];
  test('a member is refused every admin route, no session is asked to log in, and an admin passes', async () => {
    for (const route of ADMIN) {
      const [method, url] = route.split(' ');
      const body = method === 'GET' || method === 'DELETE' ? undefined : {};
      assert.equal((await member.req(method, url, body)).status, 403, route);
      assert.equal((await fetch(app.base + url, { method, headers: { 'content-type': 'application/json' },
        body: body && '{}' })).status, 401, route);
      assert.notEqual((await admin.req(method, url, body)).status, 403, route);
    }
  });

  test('DELETE /api/looks/:id: an admin deletes a shared look, never an unshared one; a curator or member cannot '
    + 'delete others\'; the owner deletes their own', async () => {
    const look = async (shared) => {
      const r = await member.post('/api/looks', { title: 'Embers', layers: [] });
      assert.equal(r.status, 201, r.text);
      if (shared) assert.equal((await member.put(`/api/looks/${r.json.look.id}`, { shared: true })).status, 200);
      return r.json.look.id;
    };
    const del = async (c, id) => (await c.req('DELETE', `/api/looks/${id}`)).status;
    const shared = await look(true), hidden = await look(false), other = await signup(app, 'dan');
    assert.equal(await del(curator, shared), 404, 'a curator');
    assert.equal(await del(other, shared), 404, 'another member');
    assert.equal(await del(admin, hidden), 404, 'an admin, on an unshared look');
    assert.equal(await del(admin, shared), 200);
    assert.equal((await member.req('GET', `/api/looks/${shared}`)).status, 404, 'gone');
    assert.equal(await del(member, hidden), 200, 'the owner');
  });
});
