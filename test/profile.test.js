// The Pi profile (SPEC-offline "The Pi profile"): no idea, model or access routes, `profile` in the session's answers,
// /pi open to curators, its own defaults, and a hosted server that listens on loopback only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { engineOn } from '../pi/test/fixture.ts';
import { controlServer } from '../pi/src/server.ts';
import { hostRefusal } from '../src/profile.ts';
import { layer, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const start = (opts) => startApp({ dataDir: mkdtempSync(path.join(tmpdir(), 'profile-')), ...opts });
const look = { title: 'Sea', layers: [layer()], chain: 2 };

describe('the Pi profile', () => {
  let pi, app, ada, cara, bob, mine;
  beforeAll(async () => {
    const r = engineOn();
    pi = await controlServer({ engine: r.engine, state: () => ({ ...r.engine.state(), looks: [], out: {} }), pin: '',
      port: 0, host: '127.0.0.1', base: '/pi' });
    app = await start({ profile: 'pi', admins: 'ada', curators: 'cara', piPreview: `http://127.0.0.1:${pi.port}` });
    [ada, cara, bob] = [await signup(app, 'ada'), await signup(app, 'cara'), await signup(app, 'bob')];
    mine = (await bob.post('/api/looks', look)).json.look;
  });
  afterAll(async () => { await app?.close(); await pi?.close(); });

  test('signing in and /api/me say pi, with no access', async () => {
    const me = (await bob.get('/api/me')).json;
    assert.equal(me.profile, 'pi');
    assert.equal(me.access, undefined);
    assert.equal((await bob.post('/api/login', { username: 'bob', password: 'correct horse' })).json.profile, 'pi');
  });

  test('the idea, model and access routes are not there', async () => {
    for (const [c, method, p] of [[bob, 'GET', '/api/ideas'], [bob, 'POST', '/api/ideas'],
      [bob, 'GET', '/api/ideas/x'], [bob, 'POST', '/api/ideas/x/undo'], [bob, 'POST', `/api/looks/${mine.id}/refine`],
      [bob, 'GET', '/api/models'], [bob, 'POST', '/api/invite'], [ada, 'GET', '/api/admin/models'],
      [ada, 'GET', '/api/admin/ideas/x/log'], [ada, 'GET', '/api/admin/invites'], [ada, 'GET', '/api/admin/people']]) {
      const body = method === 'POST' ? { text: 'Embers', code: 'abc' } : undefined;
      assert.equal((await c.req(method, p, body)).status, 404, `${method} ${p}`);
    }
  });

  test('looks, the library and the light are as hosted', async () => {
    assert.equal((await bob.get(`/api/looks/${mine.id}`)).status, 200);
    assert.equal((await bob.get('/api/library')).status, 200);
    assert.equal((await bob.get('/api/light')).status, 200);
    assert.equal((await ada.get('/api/admin/reports')).status, 200);
  });

  test('/pi is open to curators and admins, not members', async () => {
    assert.equal((await cara.get('/pi/')).status, 200);
    assert.equal((await ada.get('/pi/')).status, 200);
    const refused = await bob.get('/pi/');
    assert.equal(refused.status, 403);
    assert.match(refused.text, /for curators/);
  });
});

describe('hosted', () => {
  test('says so, with access, and keeps /pi for admins', async () => {
    const pi = await controlServer({ engine: engineOn().engine, state: () => ({ looks: [], out: {} }), pin: '',
      port: 0, host: '127.0.0.1', base: '/pi' });
    const app = await start({ admins: 'ada', curators: 'cara', piPreview: `http://127.0.0.1:${pi.port}` });
    const cara = await signup(app, 'cara');
    const me = (await cara.get('/api/me')).json;
    assert.equal(me.profile, 'hosted');
    assert.ok(me.access);
    assert.equal((await cara.get('/api/models')).status, 200);
    assert.equal((await cara.get('/pi/')).status, 403);
    await app.close();
    await pi.close();
  });
});

describe('the profile setting', () => {
  test('hosted listens on loopback only; the Pi anywhere', () => {
    for (const h of ['127.0.0.1', 'localhost', '::1']) assert.equal(hostRefusal('hosted', h), '');
    assert.match(hostRefusal('hosted', '0.0.0.0'), /HOST=0\.0\.0\.0/);
    assert.equal(hostRefusal('pi', '0.0.0.0'), '');
  });

  test('server.ts will not start hosted on the LAN', () => {
    const data = mkdtempSync(path.join(tmpdir(), 'profile-host-'));
    const r = spawnSync(process.execPath, ['server.ts'], { cwd: ROOT, encoding: 'utf8', timeout: 20_000,
      env: { PATH: process.env.PATH, HOST: '0.0.0.0', PORT: '0', STUDIO_DATA: data } });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /not started: HOST=0\.0\.0\.0/);
  });
});
