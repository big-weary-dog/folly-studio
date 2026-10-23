// Pi bundle downloads and expiring curl links (SPEC-offline "Downloading the Pi bundle"); no bundled secrets.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { curlLine } from '../public/js/ui/pi-bundle.tsx';
import { configOf } from '../src/config.ts';
import { LINK_MS, MAX_LINKS, piBundleRoutes } from '../src/pi-bundle.ts';
import { secretsIn } from '../tools/pi-bundle-check.ts';
import { client, fx, rawGet, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const COMMIT = '0123456789ab';

describe('GET /api/pi-bundle', () => {
  let app, dir, file, admin, curator, member;
  const body = Buffer.from('a tar, as far as the server cares\n'.repeat(100));
  beforeAll(async () => {
    dir = path.join(fx.tmp, 'pi-bundle');
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, `folly-studio-pi-${COMMIT}.tar`);
    fs.writeFileSync(file, body);
    app = await startApp({ dataDir: path.join(fx.tmp, 'data-pi-bundle'), admins: 'olive', curators: 'cora',
      config: configOf({ STUDIO_PI_BUNDLE: file }) });
    [admin, curator, member] = [await signup(app, 'olive'), await signup(app, 'cora'), await signup(app, 'mona')];
  });
  afterAll(() => app?.close());

  test('curators and admins download it as a file; no session is 401, anyone else 403', async () => {
    for (const who of [admin, curator]) {
      const r = await fetch(`${app.base}/api/pi-bundle`, { headers: { cookie: who.cookie } });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'application/x-tar');
      assert.equal(r.headers.get('content-length'), String(body.length));
      assert.equal(r.headers.get('content-encoding'), null);
      assert.equal(r.headers.get('cache-control'), 'private, no-store');
      assert.equal(r.headers.get('content-disposition'), `attachment; filename="folly-studio-pi-${COMMIT}.tar"`);
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), body);
    }
    const head = await fetch(`${app.base}/api/pi-bundle`, { method: 'HEAD', headers: { cookie: curator.cookie } });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(body.length));
    assert.equal((await client(app).get('/api/pi-bundle')).status, 401);
    assert.equal((await member.get('/api/pi-bundle')).status, 403);
    assert.equal((await member.post('/api/pi-bundle/link')).status, 403);
    const guest = client(app);
    await guest.post('/api/guest', { name: 'olive' });
    assert.equal((await guest.get('/api/pi-bundle/info')).status, 403);
  });

  test('a link downloads with no session; a wrong or mangled token is 404', async () => {
    const r = await admin.post('/api/pi-bundle/link');
    assert.equal(r.status, 200);
    // Only a path: the page puts its own origin in front, so the tunnel's Host and scheme never come into it.
    const proxied = await admin.post('/api/pi-bundle/link', {}, { 'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'http' });
    for (const { json } of [r, proxied]) assert.match(json.path, /^\/api\/pi-bundle\/[A-Za-z0-9_-]{43}$/);
    assert.equal(curlLine('https://folly.swampkat.com', r.json.path),
      `curl -fo folly-studio-pi.tar 'https://folly.swampkat.com${r.json.path}'`);
    assert.ok(Date.parse(r.json.expires) > Date.now() + LINK_MS - 60_000);
    const got = await fetch(app.base + r.json.path);
    assert.equal(got.status, 200);
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), body);
    const token = r.json.path.split('/').pop();
    const wrong = `${token.slice(0, 20)}${token[20] === 'A' ? 'B' : 'A'}${token.slice(21)}`;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const noncanonical = token.slice(0, -1) + alphabet[alphabet.indexOf(token.at(-1)) + 1];
    assert.deepEqual(Buffer.from(noncanonical, 'base64url'), Buffer.from(token, 'base64url'));
    for (const t of [wrong, noncanonical, 'short', `${token}A`, '%2e%2e%2fserver.ts']) {
      assert.equal((await rawGet(app.port, `/api/pi-bundle/${t}`)).status, 404, t);
    }
    // The server refuses a path that climbs before any route sees it.
    assert.equal((await rawGet(app.port, '/api/pi-bundle/../../../etc/passwd')).status, 403);
    assert.equal((await member.post('/api/pi-bundle/link', {}, { origin: 'https://evil.example' })).status, 403);
  });
});

describe('no bundle, links that expire', () => {
  const routes = (file, now) => piBundleRoutes({ file, now });
  const reply = () => ({ sent: null, h: {}, headers(h) { Object.assign(this.h, h); return this; },
    send(s) { this.sent = s; s.destroy?.(); return this; } });
  const call = (entry, params = {}) => entry[0]({ params }, reply());

  test('unset, missing or misnamed: every route is 404', async () => {
    for (const file of [undefined, path.join(fx.tmp, 'nope', `folly-studio-pi-${COMMIT}.tar`), __filename]) {
      const r = routes(file);
      for (const key of ['GET /pi-bundle/info', 'GET /pi-bundle', 'POST /pi-bundle/link']) {
        await assert.rejects(call(r[key]), { status: 404 }, `${file} ${key}`);
      }
    }
  });

  test('a link lasts an hour, and only the newest few live', async () => {
    const file = path.join(fx.tmp, `folly-studio-pi-${COMMIT}.tar`);
    fs.writeFileSync(file, 'x');
    let t = 1_000_000;
    const r = routes(file, () => t);
    const mint = async () => (await call(r['POST /pi-bundle/link'])).path.split('/').pop();
    const get = (token) => call(r['GET /pi-bundle/:token'], { token });
    const first = await mint();
    await get(first);
    t += LINK_MS - 1;
    await get(first);
    t += 1;
    await assert.rejects(get(first), { status: 404 });
    const tokens = [];
    for (let i = 0; i < MAX_LINKS + 1; i++) tokens.push(await mint());
    await assert.rejects(get(tokens[0]), { status: 404 }, 'the oldest is dropped');
    await get(tokens[1]);
    await get(tokens.at(-1));
  });
});

describe('the bundle holds nothing secret', () => {
  test('env files, keys, data, the Pi\'s own settings and git are named', () => {
    const bad = ['folly-studio/studio.env', 'folly-studio/.env', 'folly-studio/.env.local', 'folly-studio/data/',
      'folly-studio/data/users.json', 'folly-studio/backups/x.tgz', 'folly-studio/pi/config.json',
      'folly-studio/pi/light.json', 'folly-studio/pi/local/looks/a.json', 'folly-studio/.git/config',
      'folly-studio/server.pem', 'folly-studio/deploy/id_ed25519', 'folly-studio/.npmrc',
      'folly-studio/node_modules/x/.env'];
    assert.deepEqual(secretsIn(bad), bad);
    const fine = ['folly-studio/', 'folly-studio/public/js/env.d.ts', 'folly-studio/pi/config.example.json',
      'folly-studio/public/data/rig.json', 'folly-studio/pi/data/x.json', 'folly-studio/node_modules/x/test/k.pem',
      'folly-studio/dist/build.json', 'folly-studio/pi/debs/bubblewrap_0.8.0-2+deb12u1_arm64.deb'];
    assert.deepEqual(secretsIn(fine), []);
  });

  test('the tracked tree, which the bundle archives, passes', () => {
    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    assert.ok(tracked.length > 100);
    assert.deepEqual(secretsIn(tracked.map((p) => `folly-studio/${p}`)), []);
  });
});
