// Server tests: auth, CSRF, ideas, static files, the sandbox page and the store (looks: looks.test.js).
// Each server runs on port 0 with its own temp data dir and fixture public and dist dirs.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createServer } from '../src/app.js';
import { validateLayers } from '../src/api.js';
import { createStore } from '../src/store.js';
import { CSP_APP, CSP_SANDBOX } from '../src/static.js';
import {
  client, EXPECTED_APP_CSP, EXPECTED_SANDBOX_CSP, fakeBox, fx, layer, PIXEL, quiet, rawGet, SANDBOX_PAGE, signup,
  startApp, useFixture,
} from './fixtures/server.js';

useFixture();

describe('server', () => {
  let app;
  let box;
  before(async () => {
    app = await startApp({ dataDir: path.join(fx.tmp, 'data-main'), curators: 'Carol, other',
      renderBox: (box = fakeBox()) });
  });
  after(async () => {
    await app.close();
  });

  describe('auth', () => {
    test('signup, me, logout, login', async () => {
      const c = client(app);
      const r = await c.post('/api/signup', { username: 'Alice', password: 'correct horse' });
      assert.equal(r.status, 201);
      assert.deepEqual(Object.keys(r.json.user).sort(), ['id', 'role', 'username']);
      assert.equal(r.json.user.username, 'alice');
      assert.equal(r.json.user.role, 'member');
      assert.ok(c.cookie);

      const me = await c.get('/api/me');
      assert.equal(me.status, 200);
      assert.deepEqual(me.json.user, r.json.user);
      assert.equal(me.headers.get('cache-control'), 'private, no-cache', 'kept, but revalidated every time');

      const oldCookie = c.cookie;
      const out = await c.post('/api/logout');
      assert.equal(out.status, 200);
      assert.deepEqual(out.json, { ok: true });
      assert.match(out.setCookie[0], /^studio_session=;.*Max-Age=0/);
      assert.equal((await c.get('/api/me')).status, 401);
      // The old token is dead server-side, not just forgotten by the client.
      assert.equal((await c.get('/api/me', { cookie: oldCookie })).status, 401);

      const wrong = await c.post('/api/login', { username: 'alice', password: 'wrong password' });
      assert.equal(wrong.status, 401);
      assert.match(wrong.json.error, /wrong username or password/i);
      const nobody = await c.post('/api/login', { username: 'nobody-here', password: 'whatever123' });
      assert.equal(nobody.status, 401);
      assert.equal(nobody.json.error, wrong.json.error);

      const ok = await c.post('/api/login', { username: 'ALICE', password: 'correct horse' });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.user.id, r.json.user.id);
      assert.equal((await c.get('/api/me')).json.user.username, 'alice');
    });

    test('cookie flags', async () => {
      const c = client(app);
      const r = await c.post('/api/signup', { username: 'cookie-check', password: 'password123' });
      const cookie = r.setCookie.find((s) => s.startsWith('studio_session='));
      assert.ok(cookie);
      const parts = cookie.split(';').map((s) => s.trim());
      assert.match(parts[0], /^studio_session=[A-Za-z0-9_-]{43}$/);
      assert.ok(parts.includes('HttpOnly'));
      assert.ok(parts.includes('SameSite=Lax'));
      assert.ok(parts.includes('Path=/'));
      assert.ok(!parts.includes('Secure'));
      assert.ok(parts.includes(`Max-Age=${30 * 24 * 3600}`));
    });

    test('Secure cookie when secureCookies is on', async () => {
      const secure = await startApp({ dataDir: path.join(fx.tmp, 'data-secure'), secureCookies: true });
      try {
        const r = await client(secure).post('/api/signup', { username: 'secure-sam', password: 'password123' });
        assert.equal(r.status, 201);
        assert.ok(r.setCookie[0].split(';').map((s) => s.trim()).includes('Secure'));
      } finally {
        await secure.close();
      }
    });

    test('duplicate usernames are refused case-insensitively', async () => {
      await signup(app, 'dupe-user');
      const r = await client(app).post('/api/signup', { username: 'DUPE-USER', password: 'password123' });
      assert.equal(r.status, 409);
      assert.ok(r.json.error);
    });

    test('bad usernames and passwords', async () => {
      const c = client(app);
      for (const username of ['ab', 'has space', 'semi;colon', 'x'.repeat(33), 42, undefined]) {
        const r = await c.post('/api/signup', { username, password: 'password123' });
        assert.equal(r.status, 400, `username ${username}`);
      }
      for (const password of ['short', '', 12345678, undefined]) {
        const r = await c.post('/api/signup', { username: 'pw-tester', password });
        assert.equal(r.status, 400, `password ${password}`);
      }
      assert.equal(c.cookie, '');
    });

    test('carol is a curator via STUDIO_CURATORS', async () => {
      const carol = await signup(app, 'carol');
      assert.equal(carol.user.role, 'curator');
    });

    test('nothing secret reaches disk or responses', async () => {
      const c = await signup(app, 'disk-check', 'disk-check-password');
      await app.store.flush();
      const users = await readFile(path.join(fx.tmp, 'data-main', 'users.json'), 'utf8');
      assert.ok(!users.includes('disk-check-password'));
      assert.match(users, /scrypt\$/);
      const sessions = await readFile(path.join(fx.tmp, 'data-main', 'sessions.json'), 'utf8');
      const token = c.cookie.split('=')[1];
      assert.ok(!sessions.includes(token));
      const me = await c.get('/api/me');
      assert.ok(!me.text.includes('scrypt'));
      assert.ok(!me.text.includes('passwordHash'));
    });

    test('login rate limit per IP + username', async () => {
      await signup(app, 'victim');
      const c = client(app);
      for (let i = 0; i < 10; i++) {
        const r = await c.post('/api/login', { username: 'victim', password: `guess-${i}-guess` });
        assert.equal(r.status, 401, `attempt ${i + 1}`);
      }
      const blocked = await c.post('/api/login', { username: 'victim', password: 'correct horse' });
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
      // Another username from the same IP is unaffected.
      const other = await c.post('/api/login', { username: 'alice', password: 'correct horse' });
      assert.equal(other.status, 200);
    });
  });

  describe('CSRF and request limits', () => {
    let alice;
    before(async () => {
      alice = client(app);
      assert.equal((await alice.post('/api/login', { username: 'alice', password: 'correct horse' })).status, 200);
    });

    test('mutations need Content-Type: application/json', async () => {
      const plain = await alice.post('/api/ideas', JSON.stringify({ text: 'a plain text idea' }),
        { 'content-type': 'text/plain' });
      assert.equal(plain.status, 415);
      const form = await alice.post('/api/login', 'username=alice&password=correct+horse',
        { 'content-type': 'application/x-www-form-urlencoded' });
      assert.equal(form.status, 415);
      const none = await fetch(`${app.base}/api/logout`, { method: 'POST', headers: { cookie: alice.cookie } });
      assert.equal(none.status, 415);
      const del = await alice.del('/api/looks/whatever', { 'content-type': '' });
      assert.equal(del.status, 415);
      const charset = await alice.post('/api/ideas', { text: 'charset is fine' },
        { 'content-type': 'application/json; charset=utf-8' });
      assert.equal(charset.status, 201);
    });

    test('cross-origin Origin is refused, same-origin allowed', async () => {
      for (const origin of ['http://evil.example', 'null', `http://127.0.0.1:${app.port + 1}`,
        'https://evil.example:443']) {
        const r = await alice.post('/api/ideas', { text: 'cross origin idea' }, { origin });
        assert.equal(r.status, 403, origin);
      }
      const login = await client(app).post('/api/login', { username: 'alice', password: 'correct horse' },
        { origin: 'http://evil.example' });
      assert.equal(login.status, 403);
      assert.equal(login.setCookie.length, 0);
      const same = await alice.post('/api/ideas', { text: 'same origin idea' }, { origin: app.base });
      assert.equal(same.status, 201);
    });

    test('body size is capped at 256 kB', async () => {
      const big = await alice.post('/api/ideas', { text: 'x'.repeat(300 * 1024) });
      assert.equal(big.status, 413);
      assert.ok(big.json.error);
      // Under the cap the body parses (and then fails validation instead).
      const under = await alice.post('/api/ideas', { text: 'x'.repeat(200 * 1024) });
      assert.equal(under.status, 400);
      // Still works afterwards.
      assert.equal((await alice.get('/api/me')).status, 200);
    });

    test('bad JSON and non-object bodies', async () => {
      assert.equal((await alice.post('/api/ideas', '{"text":')).status, 400);
      assert.equal((await alice.post('/api/ideas', '["text"]')).status, 400);
    });

    test('unknown routes and methods', async () => {
      const r = await alice.get('/api/nope');
      assert.equal(r.status, 404);
      assert.ok(r.json.error);
      const m = await alice.req('PATCH', '/api/ideas', {});
      assert.equal(m.status, 405);
    });

    test('auth required', async () => {
      const anon = client(app);
      for (const p of ['/api/me', '/api/ideas', '/api/looks', '/api/looks?scope=gallery', '/api/ideas/abc',
        '/api/looks/abc']) {
        assert.equal((await anon.get(p)).status, 401, p);
      }
      assert.equal((await anon.post('/api/looks', { title: 't', layers: [] })).status, 401);
    });
  });

  describe('ideas', () => {
    let alice;
    let bob;
    before(async () => {
      alice = await signup(app, 'idea-alice');
      bob = await signup(app, 'idea-bob');
    });

    test('create, list, get, ownership', async () => {
      assert.equal((await alice.post('/api/ideas', { text: 'no' })).status, 400);
      assert.equal((await alice.post('/api/ideas', { text: 'x'.repeat(2001) })).status, 400);
      assert.equal((await alice.post('/api/ideas', { text: 123 })).status, 400);

      const queued0 = app.queue.enqueued.length;
      const a = await alice.post('/api/ideas', { text: '  Coral reef in the arches  ' });
      assert.equal(a.status, 201);
      const idea = a.json.idea;
      assert.equal(idea.text, 'Coral reef in the arches');
      assert.equal(idea.status, 'queued');
      assert.equal(idea.generator, 'test');
      assert.equal(idea.owner, alice.user.id);
      assert.ok(idea.id && idea.createdAt && idea.updatedAt);
      assert.equal(app.queue.enqueued.length, queued0 + 1);
      assert.equal(app.queue.enqueued.at(-1).id, idea.id);

      const b = await alice.post('/api/ideas', { text: 'Thunderstorm over the spires' });
      const list = await alice.get('/api/ideas');
      assert.deepEqual(list.json.ideas.map((i) => i.id), [b.json.idea.id, idea.id]);

      assert.equal((await alice.get(`/api/ideas/${idea.id}`)).json.idea.id, idea.id);
      assert.equal((await bob.get(`/api/ideas/${idea.id}`)).status, 404);
      assert.deepEqual((await bob.get('/api/ideas')).json.ideas, []);
      assert.equal((await alice.get('/api/ideas/does-not-exist')).status, 404);
    });

    test('20 ideas per user per day', async () => {
      const dave = await signup(app, 'idea-dave');
      for (let i = 0; i < 20; i++) {
        const r = await dave.post('/api/ideas', { text: `idea number ${i}` });
        assert.equal(r.status, 201, `idea ${i}`);
      }
      assert.equal((await dave.post('/api/ideas', { text: 'one too many' })).status, 429);
      assert.equal((await bob.post('/api/ideas', { text: 'bob still can' })).status, 201);
    });
  });


  describe('static files', () => {
    test('index, SPA routes, MIME types, security headers', async () => {
      const home = await fetch(`${app.base}/`);
      assert.equal(home.status, 200);
      assert.match(home.headers.get('content-type'), /^text\/html/);
      assert.match(await home.text(), /APP SHELL/);
      assert.equal(home.headers.get('content-security-policy'), EXPECTED_APP_CSP);
      assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(home.headers.get('referrer-policy'), 'same-origin');

      for (const p of ['/studio', '/ideas', '/looks/abc123']) {
        const r = await fetch(app.base + p);
        assert.equal(r.status, 200, p);
        assert.match(await r.text(), /APP SHELL/);
      }
      const types = { '/js/main.js': /^text\/javascript/, '/app.css': /^text\/css/, '/favicon.svg': /^image\/svg\+xml/,
        '/data/rig.json': /^application\/json/ };
      for (const [p, type] of Object.entries(types)) {
        const r = await fetch(app.base + p);
        assert.equal(r.status, 200, p);
        assert.match(r.headers.get('content-type'), type, p);
        assert.equal(r.headers.get('content-security-policy'), EXPECTED_APP_CSP);
      }
      assert.equal((await fetch(`${app.base}/missing.js`)).status, 404);
      assert.equal((await fetch(`${app.base}/js/missing.css`)).status, 404);
      assert.equal((await fetch(`${app.base}/js/main.js`, { method: 'POST' })).status, 405);

      const api404 = await fetch(`${app.base}/api/unknown-thing`);
      assert.equal(api404.status, 404);
      assert.match(api404.headers.get('content-type'), /application\/json/);
      assert.equal(api404.headers.get('content-security-policy'), EXPECTED_APP_CSP);
    });

    test('ETag revalidation', async () => {
      const r = await fetch(`${app.base}/js/main.js`);
      const etag = r.headers.get('etag');
      assert.ok(etag);
      assert.equal((await fetch(`${app.base}/js/main.js`, { headers: { 'if-none-match': etag } })).status, 304);
    });

    test('directory traversal and dotfiles are blocked', async () => {
      for (const p of [
        '/../secret.txt',
        '/js/../../secret.txt',
        '/%2e%2e/secret.txt',
        '/js/..%2f..%2fsecret.txt',
        '/%2e%2e%2fsecret.txt',
        '/..%5csecret.txt',
        '/js/%00main.js',
        '/.secret-dotfile',
        '/%2esecret-dotfile',
        '/%E0%A4%A',
      ]) {
        const r = await rawGet(app.port, p);
        assert.notEqual(r.status, 200, p);
        assert.ok(!r.body.includes('TOP SECRET') && !r.body.includes('DOTFILE'), p);
      }
    });

    test('the built sandbox page has the sandbox CSP and is kept, its name being its content', async () => {
      const r = await fetch(app.base + SANDBOX_PAGE);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-security-policy'), EXPECTED_SANDBOX_CSP);
      assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.match(r.headers.get('content-type'), /^text\/html/);
      assert.ok((await r.text()).includes('window.ok = 1;'));
      assert.equal((await fetch(`${app.base}/sandbox.html`)).status, 404, 'only the built page is served');
      assert.equal(CSP_SANDBOX, EXPECTED_SANDBOX_CSP);
      assert.equal(CSP_APP, EXPECTED_APP_CSP);
    });

    test('library lists index.json patterns that have code', async () => {
      const r = await fetch(`${app.base}/api/library`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('cache-control'), 'private, no-cache');
      const again = await fetch(`${app.base}/api/library`, { headers: { 'if-none-match': r.headers.get('etag') } });
      assert.equal(again.status, 304, 'an unchanged library moves no bytes');
      const { patterns } = await r.json();
      assert.deepEqual(patterns.map((p) => p.name), ['embers']);
      assert.equal(patterns[0].title, 'Rising embers');
      assert.equal(patterns[0].summary, 'Warm sparks');
      assert.match(patterns[0].code, /function pixel/);
      assert.deepEqual(app.loaders.loadGroups().map((g) => g.id), ['cathedral']);
    });
  });
});

describe('without public files yet', () => {
  let app;
  before(async () => {
    const empty = path.join(fx.tmp, 'public-empty');
    await mkdir(empty, { recursive: true });
    app = await createServer({
      dataDir: path.join(fx.tmp, 'data-fallback'),
      publicDir: empty,
      distDir: empty,
      log: quiet,
    });
    const addr = await app.listen(0);
    app.base = `http://127.0.0.1:${addr.port}`;
  });
  after(() => app.close());

  test('library and groups are empty, missing index.html (no build yet) is a 404', async () => {
    assert.deepEqual((await (await fetch(`${app.base}/api/library`)).json()).patterns, []);
    assert.deepEqual(app.loaders.loadGroups(), []);
    assert.equal((await fetch(`${app.base}/`)).status, 404);
    assert.equal((await fetch(`${app.base}/sandbox.html`)).status, 404);
  });
});

describe('store', () => {
  test('create/get/list/update/remove persist atomically and reload', async () => {
    const dir = path.join(fx.tmp, 'store-test');
    const store = await createStore(dir, { log: quiet });
    const a = store.looks.create({ title: 'A', owner: 'u1' });
    assert.match(a.id, /^[A-Za-z0-9_-]{16}$/);
    assert.ok(a.createdAt && a.updatedAt);
    const b = store.looks.create({ title: 'B', owner: 'u2' });
    a.title = 'mutated copy';
    assert.equal(store.looks.get(a.id).title, 'A');
    assert.deepEqual(store.looks.list((l) => l.owner === 'u2').map((l) => l.id), [b.id]);
    assert.equal(store.looks.list().length, 2);

    await new Promise((r) => setTimeout(r, 2));
    const u = store.looks.update(a.id, { title: 'A2', id: 'hijack', owner: undefined });
    assert.equal(u.id, a.id);
    assert.equal(u.title, 'A2');
    assert.equal('owner' in u, false);
    assert.ok(u.updatedAt > u.createdAt);
    assert.equal(store.looks.update('missing', { x: 1 }), null);
    assert.equal(store.looks.remove(b.id), true);
    assert.equal(store.looks.remove(b.id), false);
    assert.equal(store.looks.get(b.id), null);
    const s = store.sessions.create({ id: 'given-id', userId: a.id });
    assert.equal(s.id, 'given-id');
    assert.throws(() => store.sessions.create({ id: 'given-id' }));

    // Many quick writes coalesce and land.
    for (let i = 0; i < 50; i++) store.ideas.create({ n: i });
    await store.flush();

    const again = await createStore(dir, { log: quiet });
    assert.equal(again.looks.get(a.id).title, 'A2');
    assert.equal(again.looks.get(b.id), null);
    assert.equal(again.ideas.list().length, 50);
    assert.deepEqual(again.ideas.list().map((i) => i.n), [...Array(50).keys()]);
    assert.equal(again.users.list().length, 0);
    const raw = JSON.parse(await readFile(path.join(dir, 'ideas.json'), 'utf8'));
    assert.equal(raw.length, 50);
  });

  test('refuses to start on a corrupt file', async () => {
    const dir = path.join(fx.tmp, 'store-corrupt');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'looks.json'), '[{"id": ');
    await assert.rejects(createStore(dir, { log: quiet }), /not valid JSON/);
  });
});

test('validateLayers keeps small UI flags and drops bulky extras', () => {
  const [l] = validateLayers([{ code: PIXEL, enabled: false, solo: true, blob: { big: 1 } }]);
  assert.equal(l.enabled, false);
  assert.equal(l.solo, true);
  assert.equal('blob' in l, false);
});
