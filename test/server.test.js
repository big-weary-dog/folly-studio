// Server tests: auth, CSRF, ideas, looks, static files, sandbox, store.
// Each server runs on port 0 with its own temp data dir and a fixture public dir.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createServer, validateLayers } from '../src/api.js';
import { createStore } from '../src/store.js';
import { CSP_APP, CSP_SANDBOX } from '../src/static.js';

const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
const EXPECTED_APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; " +
  "frame-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const EXPECTED_SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; sandbox allow-scripts";
const CORE_SOURCE = "export const STDLIB = {}; const s = 'a$&b$1c'; const t = '</script>';\n";
const PIXEL = 'function pixel(p, t, P) { return [p.x, p.y, p.z]; }';

let tmp;
let publicDir;

async function writeFixture(dir) {
  await mkdir(path.join(dir, 'js'), { recursive: true });
  await mkdir(path.join(dir, 'patterns'), { recursive: true });
  await mkdir(path.join(dir, 'data'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>Folly Studio</title><p>APP SHELL</p>');
  await writeFile(path.join(dir, 'sandbox.html'), '<!doctype html><script>/*@CORE@*/\nwindow.ok = 1;</script>');
  await writeFile(path.join(dir, 'js', 'pattern-core.js'), CORE_SOURCE);
  await writeFile(path.join(dir, 'js', 'main.js'), 'console.log("main");');
  await writeFile(path.join(dir, 'app.css'), 'body { color: red }');
  await writeFile(path.join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(path.join(dir, '.secret-dotfile'), 'DOTFILE');
  await writeFile(
    path.join(dir, 'patterns', 'index.json'),
    JSON.stringify([
      { name: 'embers', title: 'Rising embers', summary: 'Warm sparks', tags: ['warm'] },
      { name: 'missing', title: 'No file' },
      { name: '../evil', title: 'Traversal' },
    ]),
  );
  await writeFile(path.join(dir, 'patterns', 'embers.js'), `// Rising embers\n${PIXEL}\n`);
  await writeFile(
    path.join(dir, 'data', 'cathedral.json'),
    JSON.stringify({ version: 1, groups: [{ id: 'cathedral', name: 'Cathedral', parent: null, zones: [0] }] }),
  );
}

function fakeQueue() {
  return { enqueued: [], enqueue(idea) { this.enqueued.push(idea); }, async idle() {} };
}

async function startApp(opts = {}) {
  const app = await createServer({ publicDir, generator: fakeQueue(), generatorName: 'test', log: quiet, ...opts });
  const addr = await app.listen(0, '127.0.0.1');
  app.base = `http://127.0.0.1:${addr.port}`;
  app.port = addr.port;
  return app;
}

/** A tiny cookie-keeping JSON client. */
function client(app) {
  let cookie = '';
  async function req(method, p, body, headers = {}) {
    const h = { ...headers };
    if (cookie && !('cookie' in h)) h.cookie = cookie;
    if (method !== 'GET' && !('content-type' in h)) h['content-type'] = 'application/json';
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const res = await fetch(app.base + p, { method, headers: h, body: payload });
    const setCookie = res.headers.getSetCookie();
    for (const c of setCookie) {
      const m = /^studio_session=([^;]*)/.exec(c);
      if (m) cookie = m[1] ? `studio_session=${m[1]}` : '';
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, headers: res.headers, json, text, setCookie };
  }
  return {
    req,
    get: (p, h) => req('GET', p, undefined, h),
    post: (p, b, h) => req('POST', p, b ?? {}, h),
    put: (p, b, h) => req('PUT', p, b, h),
    del: (p, h) => req('DELETE', p, undefined, h),
    get cookie() {
      return cookie;
    },
    set cookie(v) {
      cookie = v;
    },
  };
}

async function signup(app, username, password = 'correct horse') {
  const c = client(app);
  const r = await c.post('/api/signup', { username, password });
  assert.equal(r.status, 201, `signup ${username}: ${r.text}`);
  c.user = r.json.user;
  return c;
}

/** Raw GET with an unnormalized path (fetch would collapse ../). */
function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    r.end();
  });
}

const layer = (extra = {}) => ({ id: 'l1', title: 'Sea', code: PIXEL, groups: ['cathedral'], blend: 'add', level: 1, params: { speed: 0.4 }, ...extra });

before(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'studio-server-test-'));
  publicDir = path.join(tmp, 'public');
  await writeFixture(publicDir);
  await writeFile(path.join(tmp, 'secret.txt'), 'TOP SECRET');
});

after(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('server', () => {
  let app;
  before(async () => {
    app = await startApp({ dataDir: path.join(tmp, 'data-main'), curators: 'Carol, other' });
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
      assert.equal(me.headers.get('cache-control'), 'no-store');

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
      const secure = await startApp({ dataDir: path.join(tmp, 'data-secure'), secureCookies: true });
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
      const users = await readFile(path.join(tmp, 'data-main', 'users.json'), 'utf8');
      assert.ok(!users.includes('disk-check-password'));
      assert.match(users, /scrypt\$/);
      const sessions = await readFile(path.join(tmp, 'data-main', 'sessions.json'), 'utf8');
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
      const plain = await alice.post('/api/ideas', JSON.stringify({ text: 'a plain text idea' }), { 'content-type': 'text/plain' });
      assert.equal(plain.status, 415);
      const form = await alice.post('/api/login', 'username=alice&password=correct+horse', { 'content-type': 'application/x-www-form-urlencoded' });
      assert.equal(form.status, 415);
      const none = await fetch(`${app.base}/api/logout`, { method: 'POST', headers: { cookie: alice.cookie } });
      assert.equal(none.status, 415);
      const del = await alice.del('/api/looks/whatever', { 'content-type': '' });
      assert.equal(del.status, 415);
      const charset = await alice.post('/api/ideas', { text: 'charset is fine' }, { 'content-type': 'application/json; charset=utf-8' });
      assert.equal(charset.status, 201);
    });

    test('cross-origin Origin is refused, same-origin allowed', async () => {
      for (const origin of ['http://evil.example', 'null', `http://127.0.0.1:${app.port + 1}`, 'https://evil.example:443']) {
        const r = await alice.post('/api/ideas', { text: 'cross origin idea' }, { origin });
        assert.equal(r.status, 403, origin);
      }
      const login = await client(app).post('/api/login', { username: 'alice', password: 'correct horse' }, { origin: 'http://evil.example' });
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
      for (const p of ['/api/me', '/api/ideas', '/api/looks', '/api/looks?scope=gallery', '/api/ideas/abc', '/api/looks/abc']) {
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

  describe('looks', () => {
    let alice;
    let bob;
    let carol;
    before(async () => {
      alice = await signup(app, 'look-alice');
      bob = await signup(app, 'look-bob');
      carol = client(app);
      assert.equal((await carol.post('/api/login', { username: 'carol', password: 'correct horse' })).status, 200);
    });

    test('create validates and defaults', async () => {
      const r = await alice.post('/api/looks', { title: ' Coral reef ', layers: [{ code: PIXEL }] });
      assert.equal(r.status, 201);
      const look = r.json.look;
      assert.equal(look.title, 'Coral reef');
      assert.equal(look.summary, '');
      assert.equal(look.owner, alice.user.id);
      assert.equal(look.ownerName, 'look-alice');
      assert.equal(look.shared, false);
      assert.equal(look.reviewed, false);
      assert.equal('versions' in look, false);
      assert.deepEqual(look.layers, [{ id: 'l1', title: '', code: PIXEL, groups: ['cathedral'], blend: 'add', level: 1, params: {} }]);

      const bads = [
        { layers: [layer()] },
        { title: 'x', layers: 'nope' },
        { title: 'x', layers: Array.from({ length: 9 }, (_, i) => layer({ id: `l${i}` })) },
        { title: 'x', layers: [layer({ code: 42 })] },
        { title: 'x', layers: [layer({ code: `// ${'x'.repeat(20 * 1024)}` })] },
        { title: 'x', layers: [layer({ groups: 'cathedral' })] },
        { title: 'x', layers: [layer({ groups: [1] })] },
        { title: 'x', layers: [layer({ blend: 'screen' })] },
        { title: 'x', layers: [layer({ level: 1.5 })] },
        { title: 'x', layers: [layer({ level: -0.1 })] },
        { title: 'x', layers: [layer({ params: [] })] },
        { title: 'x', layers: [layer({ params: { a: { nested: true } } })] },
        { title: 'x', layers: [layer(), layer()] },
        { title: 'x', layers: [layer()], ideaId: 'not-mine' },
      ];
      for (const body of bads) {
        const res = await alice.post('/api/looks', body);
        assert.equal(res.status, 400, JSON.stringify(body).slice(0, 120));
        assert.ok(res.json.error);
      }
      const eight = Array.from({ length: 8 }, (_, i) => layer({ id: `l${i}`, blend: ['add', 'over', 'max', 'multiply'][i % 4], level: i / 7 }));
      assert.equal((await alice.post('/api/looks', { title: 'Eight', layers: eight })).status, 201);
    });

    test('ideaId must be my idea', async () => {
      const idea = (await alice.post('/api/ideas', { text: 'linked idea' })).json.idea;
      const ok = await alice.post('/api/looks', { title: 'From idea', layers: [layer()], ideaId: idea.id });
      assert.equal(ok.status, 201);
      assert.equal(ok.json.look.ideaId, idea.id);
      assert.equal((await bob.post('/api/looks', { title: 'Stolen', layers: [layer()], ideaId: idea.id })).status, 400);
    });

    test('ownership, sharing, gallery', async () => {
      const a1 = (await alice.post('/api/looks', { title: 'First', layers: [layer()] })).json.look;
      const a2 = (await alice.post('/api/looks', { title: 'Second', layers: [layer()] })).json.look;

      // Private: invisible to others.
      assert.equal((await bob.get(`/api/looks/${a1.id}`)).status, 404);
      assert.equal((await bob.put(`/api/looks/${a1.id}`, { title: 'Mine now' })).status, 404);
      assert.equal((await bob.del(`/api/looks/${a1.id}`)).status, 404);
      assert.ok(!(await bob.get('/api/looks?scope=gallery')).json.looks.some((l) => l.id === a1.id));

      const mine = (await alice.get('/api/looks')).json.looks.map((l) => l.id);
      assert.ok(mine.includes(a1.id) && mine.includes(a2.id));
      assert.ok(!(await bob.get('/api/looks?scope=mine')).json.looks.some((l) => l.owner === alice.user.id));
      assert.equal((await alice.get('/api/looks?scope=everything')).status, 400);

      // Share a1 then a2: gallery is newest first.
      assert.equal((await alice.put(`/api/looks/${a1.id}`, { shared: true })).json.look.shared, true);
      await new Promise((r) => setTimeout(r, 5));
      assert.equal((await alice.put(`/api/looks/${a2.id}`, { shared: true })).status, 200);
      const gallery = (await bob.get('/api/looks?scope=gallery')).json.looks;
      const ids = gallery.map((l) => l.id);
      assert.ok(ids.indexOf(a2.id) < ids.indexOf(a1.id) && ids.indexOf(a2.id) >= 0);
      assert.ok(gallery.every((l) => l.shared === true && !('versions' in l)));
      assert.equal(gallery.find((l) => l.id === a1.id).ownerName, 'look-alice');

      // Shared: visible, still not editable or deletable by others.
      assert.equal((await bob.get(`/api/looks/${a1.id}`)).json.look.title, 'First');
      assert.equal((await bob.put(`/api/looks/${a1.id}`, { title: 'Mine now' })).status, 403);
      assert.equal((await bob.del(`/api/looks/${a1.id}`)).status, 403);

      // Unshare: gone again.
      await alice.put(`/api/looks/${a1.id}`, { shared: false });
      assert.equal((await bob.get(`/api/looks/${a1.id}`)).status, 404);

      // Delete.
      const del = await alice.del(`/api/looks/${a2.id}`);
      assert.deepEqual(del.json, { ok: true });
      assert.equal((await alice.get(`/api/looks/${a2.id}`)).status, 404);
      assert.equal((await alice.del(`/api/looks/${a2.id}`)).status, 404);
    });

    test('PUT keeps up to 20 previous versions, shown only with ?versions=1', async () => {
      const look = (await alice.post('/api/looks', { title: 'Versioned', layers: [layer({ level: 0 })] })).json.look;
      const r1 = await alice.put(`/api/looks/${look.id}`, { layers: [layer({ level: 0.5 })] });
      assert.equal(r1.status, 200);
      assert.equal(r1.json.look.layers[0].level, 0.5);
      assert.equal('versions' in r1.json.look, false);

      const full = await alice.get(`/api/looks/${look.id}?versions=1`);
      assert.equal(full.json.look.versions.length, 1);
      assert.equal(full.json.look.versions[0].layers[0].level, 0);
      assert.equal('versions' in (await alice.get(`/api/looks/${look.id}`)).json.look, false);

      // Title-only and identical-layer saves add no version.
      await alice.put(`/api/looks/${look.id}`, { title: 'Renamed', layers: [layer({ level: 0.5 })] });
      assert.equal((await alice.get(`/api/looks/${look.id}?versions=1`)).json.look.versions.length, 1);

      for (let i = 1; i <= 25; i++) await alice.put(`/api/looks/${look.id}`, { layers: [layer({ level: i / 100 })] });
      const capped = (await alice.put(`/api/looks/${look.id}?versions=1`, { title: 'Done' })).json.look;
      assert.equal(capped.versions.length, 20);
      assert.equal(capped.versions.at(-1).layers[0].level, 0.24);
      assert.equal(capped.title, 'Done');

      // Others never see versions, even of a shared look.
      await alice.put(`/api/looks/${look.id}`, { shared: true });
      assert.equal('versions' in (await bob.get(`/api/looks/${look.id}?versions=1`)).json.look, false);

      // Invalid layers on PUT are rejected and nothing changes.
      assert.equal((await alice.put(`/api/looks/${look.id}`, { layers: [layer({ blend: 'nope' })] })).status, 400);
      assert.equal((await alice.get(`/api/looks/${look.id}`)).json.look.layers[0].level, 0.25);
    });

    test('reviewed is curator-only', async () => {
      const look = (await alice.post('/api/looks', { title: 'Review me', layers: [layer()], shared: true })).json.look;
      assert.equal(look.shared, true);

      assert.equal((await alice.put(`/api/looks/${look.id}`, { reviewed: true })).status, 403);
      assert.equal((await bob.put(`/api/looks/${look.id}`, { reviewed: true })).status, 403);
      // Echoing the unchanged value is harmless.
      assert.equal((await alice.put(`/api/looks/${look.id}`, { title: 'Review me', reviewed: false })).status, 200);

      const ok = await carol.put(`/api/looks/${look.id}`, { reviewed: true });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.look.reviewed, true);
      assert.equal((await bob.get(`/api/looks/${look.id}`)).json.look.reviewed, true);
      // A curator may not edit someone else's content.
      assert.equal((await carol.put(`/api/looks/${look.id}`, { title: 'Curated', reviewed: true })).status, 403);

      // New code from the owner clears the review.
      const edited = await alice.put(`/api/looks/${look.id}`, { layers: [layer({ level: 0.3 })] });
      assert.equal(edited.json.look.reviewed, false);

      // A curator cannot review a private look of someone else.
      const priv = (await alice.post('/api/looks', { title: 'Private', layers: [layer()] })).json.look;
      assert.equal((await carol.put(`/api/looks/${priv.id}`, { reviewed: true })).status, 404);
      // But can review their own.
      const own = (await carol.post('/api/looks', { title: 'Carol own', layers: [layer()] })).json.look;
      assert.equal((await carol.put(`/api/looks/${own.id}`, { reviewed: true })).json.look.reviewed, true);
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
      const types = { '/js/main.js': /^text\/javascript/, '/app.css': /^text\/css/, '/favicon.svg': /^image\/svg\+xml/, '/data/cathedral.json': /^application\/json/ };
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

    test('sandbox.html inlines the core with the sandbox CSP', async () => {
      const r = await fetch(`${app.base}/sandbox.html`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-security-policy'), EXPECTED_SANDBOX_CSP);
      assert.match(r.headers.get('content-type'), /^text\/html/);
      const html = await r.text();
      assert.ok(!html.includes('/*@CORE@*/'));
      assert.ok(html.includes("const s = 'a$&b$1c';"), 'replacement patterns are not expanded');
      assert.ok(html.includes("const t = '<\\/script>';"), 'a </script> inside the core cannot end the element');
      assert.ok(html.includes('window.ok = 1;'));
      assert.equal(CSP_SANDBOX, EXPECTED_SANDBOX_CSP);
      assert.equal(CSP_APP, EXPECTED_APP_CSP);
    });

    test('library lists index.json patterns that have code', async () => {
      const r = await fetch(`${app.base}/api/library`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      const { patterns } = await r.json();
      assert.deepEqual(patterns.map((p) => p.name), ['embers']);
      assert.equal(patterns[0].title, 'Rising embers');
      assert.equal(patterns[0].summary, 'Warm sparks');
      assert.match(patterns[0].code, /function pixel/);
      assert.deepEqual(app.loaders.loadGroups().map((g) => g.id), ['cathedral']);
    });
  });
});

describe('without a generator or public files yet', () => {
  let app;
  before(async () => {
    const empty = path.join(tmp, 'public-empty');
    await mkdir(empty, { recursive: true });
    app = await createServer({
      dataDir: path.join(tmp, 'data-fallback'),
      publicDir: empty,
      generatorModule: new URL('./no-such-generator.js', import.meta.url).href,
      log: quiet,
    });
    const addr = await app.listen(0);
    app.base = `http://127.0.0.1:${addr.port}`;
  });
  after(() => app.close());

  test('falls back to a queue that marks ideas failed', async () => {
    const c = client(app);
    assert.equal((await c.post('/api/signup', { username: 'fallback', password: 'password123' })).status, 201);
    const r = await c.post('/api/ideas', { text: 'an idea with no generator' });
    assert.equal(r.status, 201);
    assert.equal(r.json.idea.generator, 'none');
    assert.equal(r.json.idea.status, 'failed');
    assert.ok(r.json.idea.error);
  });

  test('library and groups are empty, missing index.html is a 404', async () => {
    assert.deepEqual((await (await fetch(`${app.base}/api/library`)).json()).patterns, []);
    assert.deepEqual(app.loaders.loadGroups(), []);
    assert.equal((await fetch(`${app.base}/`)).status, 404);
    assert.equal((await fetch(`${app.base}/sandbox.html`)).status, 404);
  });
});

describe('store', () => {
  test('create/get/list/update/remove persist atomically and reload', async () => {
    const dir = path.join(tmp, 'store-test');
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
    const dir = path.join(tmp, 'store-corrupt');
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
