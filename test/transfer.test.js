// What visits move over the wire, against the real server and the real public/ files (test/fixtures/browser.js
// keeps an HTTP cache the way a browser does). A cold Studio load (the shell, its theme and modules, the
// Studio's lazy modules, the sandbox, cathedral.json and the API calls) stays within COLD; a reload, even
// a day later, sends only the shell and the API calls, each a 304; an idea session polls little, and lists
// carry no code.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { createServer } from '../src/app.js';
import { browser, request } from './fixtures/browser.js';

const KB = 1024;
// Measured: 176 KB with br, 204 KB with gzip only (HTTP/1.1 headers counted in full; HTTP/2 shrinks them).
const COLD = { 'br, gzip': 190 * KB, gzip: 220 * KB };
const STUDIO = { view: './ui/studio.js', api: ['/api/me', '/api/library'] };
const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
const kb = (n) => `${(n / KB).toFixed(1)} KB`;
let app, dir, port, cookie;

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'studio-transfer-'));
  app = await createServer({ dataDir: dir, generator: { enqueue() {} }, log: quiet });
  port = (await app.listen(0)).port;
  const res = await request(port, '/api/signup', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'wire', password: 'correct horse' }) });
  assert.equal(res.status, 201);
  cookie = /studio_session=[^;]+/.exec(res.headers['set-cookie'][0])[0];
  // A dozen looks of library code, as a list would show them.
  const user = app.store.users.list()[0];
  const lib = JSON.parse(await readFile(new URL('../public/patterns/index.json', import.meta.url), 'utf8'));
  for (let i = 0; i < 12; i++) {
    const layers = await Promise.all([0, 1, 2].map(async (k) => ({ id: `l${k}`, title: 'x', groups: ['cathedral'],
      code: await readFile(new URL(`../public/patterns/${lib[(i + k) % lib.length].name}.js`, import.meta.url), 'utf8'),
      blend: 'add', level: 1, params: {} })));
    app.store.looks.create({ owner: user.id, ownerName: user.username, title: `Look ${i}`, layers, shared: true,
      sharedAt: new Date().toISOString(), reviewed: false, versions: [] });
  }
});
after(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

for (const encoding of Object.keys(COLD)) {
  test(`a cold Studio load stays within ${COLD[encoding] / KB} KB on the wire (${encoding})`, async (t) => {
    const b = browser(port, { encoding, cookie });
    await b.load('/studio', STUDIO);
    for (const r of b.log) assert.ok(r.status === 200 || r.status === 'cache', `${r.url}: ${r.status}`);
    for (const url of ['/js/ui/studio.js', '/data/cathedral.json', '/sandbox.html', '/css/theme.css']) {
      const hashed = b.log.find((r) => r.url.replace(/\.[0-9a-f]{10}(\.\w+)$/, '$1') === url);
      assert.ok(hashed && hashed.url !== url, `${url} is loaded by its content-hashed URL`);
    }
    assert.equal(b.log.filter((r) => r.url.startsWith('/css/') && r.status === 200).length, 1, 'one stylesheet');
    const { requests, bytes } = b.total();
    t.diagnostic(`${requests} requests, ${kb(bytes)}`);
    assert.ok(bytes <= COLD[encoding], `${kb(bytes)} > ${kb(COLD[encoding])}`);
  });
}

test('a reload, a minute or a day later, sends only the shell and the API calls: 304s', async (t) => {
  const b = browser(port, { cookie });
  await b.load('/studio', STUDIO);
  for (const later of [60, 24 * 3600]) {
    const from = b.log.length;
    b.tick(later);
    await b.load('/studio', STUDIO);
    const sent = b.log.slice(from).filter((r) => r.status !== 'cache');
    assert.deepEqual(sent.map((r) => r.url), ['/studio', ...STUDIO.api]);
    assert.ok(sent.every((r) => r.status === 304), sent.map((r) => `${r.url} ${r.status}`).join(', '));
    const { bytes } = b.total(from);
    t.diagnostic(`after ${later} s: ${sent.length} requests, ${kb(bytes)}`);
    assert.ok(bytes <= 2 * KB, kb(bytes));
  }
});

test('an idea session: polls back off and answer 304s; lists carry metadata, not code', async (t) => {
  const b = browser(port, { cookie });
  await b.load('/ideas', { view: './ui/pages.js', api: ['/api/me', '/api/ideas'] });
  const { idea } = JSON.parse((await b.call('POST', '/api/ideas', { text: 'Rising embers drift up the spires' })).text);
  app.store.ideas.update(idea.id, { status: 'generating' });
  // ui/pages.js: the pending idea after 2 s, then 1.5× as long each time, up to 10 s; ready after 60 s here.
  const from = b.log.length;
  let polls = 0;
  for (let t = 0, wait = 2; ; t += wait, wait = Math.min(10, wait * 1.5)) {
    b.tick(wait);
    if (t + wait >= 60) app.store.ideas.update(idea.id, { status: 'ready', lookId: 'x' });
    polls++;
    if (JSON.parse((await b.fetch(`/api/ideas/${idea.id}`)).text).idea.status === 'ready') break;
  }
  const poll = b.total(from);
  assert.ok(polls <= 10, `${polls} polls`);
  assert.ok(b.log.slice(from + 1, -1).every((r) => r.status === 304), 'an unchanged idea answers 304');
  const lists = b.log.length;
  await b.load('/looks', { shell: false, view: './ui/pages.js', api: ['/api/looks?scope=mine'] });
  await b.load('/gallery', { shell: false, view: './ui/pages.js', api: ['/api/looks?scope=gallery'] });
  const listed = b.total(lists);
  for (const scope of ['mine', 'gallery']) {
    const { looks } = JSON.parse((await b.fetch(`/api/looks?scope=${scope}`)).text);
    assert.equal(looks.length, 12);
    assert.ok(looks.every((l) => !('layers' in l) && l.layerCount === 3), 'no layers in a list');
  }
  t.diagnostic(`${polls} polls over 60 s: ${kb(poll.bytes)}; My looks + Gallery: ${kb(listed.bytes)}; `
    + `the whole session ${kb(b.total().bytes)}`);
  assert.ok(listed.bytes <= 8 * KB, kb(listed.bytes));
});
