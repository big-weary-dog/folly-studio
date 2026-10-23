// Who may do what (shared/policy.ts), and the routes that need a role: every /admin route declares one, or the
// server does not start (http.ts's adminsDeclared); a member is refused each, and no session is asked to log in.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, test, vi } from 'vitest';

import { can } from '../shared/policy.ts';
import { adminsDeclared } from '../src/http.ts';
import * as http from '../src/http.ts';
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

  let app, member, admin, curator, pi, piMember, piAdmin;
  const registered = [], dirs = [];
  const dir = () => {
    const d = mkdtempSync(path.join(tmpdir(), 'permissions-'));
    dirs.push(d);
    return d;
  };
  beforeAll(async () => {
    const check = http.adminsDeclared;
    const spy = vi.spyOn(http, 'adminsDeclared').mockImplementation((route) => {
      check(route);
      if (route.config?.role === 'admin' && route.method !== 'HEAD') {
        registered.push({ method: route.method, url: route.url });
      }
    });
    try {
      app = await startApp({ admins: 'ada', curators: 'cat', dataDir: dir() });
      pi = await startApp({ profile: 'pi', admins: 'ada', dataDir: dir(), piPreview: 'http://127.0.0.1:1' });
    } finally { spy.mockRestore(); }
    [admin, member, curator] = [await signup(app, 'ada'), await signup(app, 'bob'), await signup(app, 'cat')];
    [piAdmin, piMember] = [await signup(pi, 'ada'), await signup(pi, 'bob')];
  });
  afterAll(async () => {
    await Promise.all([app?.close(), pi?.close()]);
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  const expected = {
    'GET /api/admin/models': 200, 'PUT /api/admin/models': 400, 'PUT /api/admin/light': 400,
    'GET /api/admin/invites': 200, 'POST /api/admin/invites': 201, 'DELETE /api/admin/invites/:id': 404,
    'GET /api/admin/people': 200, 'PUT /api/admin/people/:id': 404, 'GET /api/admin/reports': 200,
    'GET /api/admin/reports/:id': 404, 'GET /api/admin/reports/:id/shot': 404,
    'GET /api/admin/ideas/:id/log': 404, 'GET /api/admin/ideas/:id/log/stills/:name': 400,
    'PUT /api/admin/baking': 400, 'PUT /api/admin/lights': 200, 'GET /api/admin/stats': 200,
  };
  test('a member is refused every admin route, no session is asked to log in, and an admin passes', async () => {
    const routes = [...new Map(registered.map((r) => [`${r.method} ${r.url}`, r])).values()];
    assert.ok(routes.length > 0, 'registered admin routes were captured');
    for (const { method, url: pattern } of routes) {
      const route = `${method} ${pattern}`, url = pattern.replace(/:[^/]+/g, 'missing');
      assert.ok(Object.hasOwn(expected, route), `${route} needs an expected admin status`);
      const onPi = pattern === '/api/admin/lights';
      const [server, user, boss] = onPi ? [pi, piMember, piAdmin] : [app, member, admin];
      const body = method === 'GET' || method === 'DELETE' ? undefined : {};
      assert.equal((await user.req(method, url, body)).status, 403, route);
      assert.equal((await fetch(server.base + url, { method, headers: { 'content-type': 'application/json' },
        body: body && '{}' })).status, 401, route);
      assert.equal((await boss.req(method, url, body)).status, expected[route], route);
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
