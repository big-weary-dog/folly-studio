// What visits move over the wire, against the real server and the app as Vite builds it (test/fixtures/browser.js
// keeps an HTTP cache the way a browser does). A cold Studio load (the shell, its styles and modules, the
// Studio's lazy modules and styles, the sandbox, rig.json and the API calls) stays within COLD; a reload, even
// a day later, sends only the shell and the API calls, each a 304; an idea session polls little, and lists
// carry no code.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, test } from 'vitest';

import { createServer } from '../src/app.ts';
import { browser, request } from './fixtures/browser.js';
import { builtApp, removeBuiltApp } from './fixtures/build.js';

const KB = 1024;
// Measured: 215 KB in 17 requests with br, 255 KB with gzip only (HTTP/1.1 headers counted in full; HTTP/2 shrinks
// them). rig.json is 31 KB of that with br (43 KB gzip): the LEDs, and the 3D view's rose cells, floods and scaffold.
const COLD = { 'br, gzip': 220 * KB, gzip: 260 * KB };
const STUDIO = { view: 'js/ui/studio.tsx', api: ['/api/me', '/api/library'] };
const PLAYA = { view: 'js/playa/renderer.ts', shell: false };   // the 3D view's default mode, imported on show
const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
const kb = (n) => `${(n / KB).toFixed(1)} KB`;
let app, dir, port, cookie, manifest;

beforeAll(async () => {
  const dist = await builtApp();
  manifest = JSON.parse(await readFile(path.join(dist, '.vite/manifest.json'), 'utf8'));
  dir = await mkdtemp(path.join(os.tmpdir(), 'studio-transfer-'));
  app = await createServer({ dataDir: dir, distDir: dist, generator: { enqueue() {} }, log: quiet,
    admins: 'wire' }); // Sketch, the one model here, is admins' alone
  port = (await app.listen(0)).port;
  const res = await request(port, '/api/signup', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'wire', password: 'correct horse' }) });
  assert.equal(res.status, 201);
  cookie = /studio_session=[^;]+/.exec(res.headers['set-cookie'][0])[0];
  // A dozen looks of library code, as a list would show them.
  const user = app.store.users.list()[0];
  const lib = JSON.parse(await readFile(new URL('../public/patterns/index.json', import.meta.url), 'utf8'))
    .filter((e) => e.kind !== 'preset');
  for (let i = 0; i < 12; i++) {
    const layers = await Promise.all([0, 1, 2].map(async (k) => ({ id: `l${k}`, title: 'x', groups: ['cathedral'],
      code: await readFile(new URL(`../public/patterns/${lib[(i + k) % lib.length].name}.js`, import.meta.url), 'utf8'),
      blend: 'add', level: 1, params: {} })));
    app.store.looks.create({ owner: user.id, ownerName: user.username, title: `Look ${i}`, layers, shared: true,
      sharedAt: new Date().toISOString(), reviewed: false, versions: [] });
  }
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
  await removeBuiltApp();
});

for (const encoding of Object.keys(COLD)) {
  test(`a cold Studio load stays within ${COLD[encoding] / KB} KB on the wire (${encoding})`, async () => {
    const b = browser(port, { encoding, cookie, manifest });
    await b.load('/studio', STUDIO);
    await b.load('/studio', PLAYA);
    for (const r of b.log) assert.ok(r.status === 200 || r.status === 'cache', `${r.url}: ${r.status}`);
    const files = b.log.filter((r) => !/^\/(?:studio|api\/)/.test(r.url)).map((r) => r.url);
    for (const url of files) assert.match(url, /^\/assets\/[\w.-]+-[\w-]{8}\.\w+$/, 'by its content-hashed name');
    for (const name of ['studio-*.js', 'studio-*.css', 'rig-*.json', 'sandbox-*.html', 'renderer-*.js']) {
      const want = new RegExp(`/${name.replace('*', '[\\w-]+').replace('.', '\\.')}$`);
      assert.ok(files.some((url) => want.test(url)), `${name} is loaded`);
    }
    const { requests, bytes } = b.total();
    console.info(`${requests} requests, ${kb(bytes)}`);
    assert.ok(bytes <= COLD[encoding], `${kb(bytes)} > ${kb(COLD[encoding])}`);
  });
}

test('a reload, a minute or a day later, sends only the shell and the API calls: 304s', async () => {
  const b = browser(port, { cookie, manifest });
  await b.load('/studio', STUDIO);
  for (const later of [60, 24 * 3600]) {
    const from = b.log.length;
    b.tick(later);
    await b.load('/studio', STUDIO);
    const sent = b.log.slice(from).filter((r) => r.status !== 'cache');
    assert.deepEqual(sent.map((r) => r.url), ['/studio', ...STUDIO.api]);
    assert.ok(sent.every((r) => r.status === 304), sent.map((r) => `${r.url} ${r.status}`).join(', '));
    const { bytes } = b.total(from);
    console.info(`after ${later} s: ${sent.length} requests, ${kb(bytes)}`);
    assert.ok(bytes <= 2 * KB, kb(bytes));
  }
});

test('an idea session: polls back off and answer 304s; lists carry metadata, not code', async () => {
  const b = browser(port, { cookie, manifest });
  await b.load('/ideas', { view: 'js/ui/pages.tsx', api: ['/api/me', '/api/ideas', '/api/models'] });
  const body = { text: 'Rising embers drift up the spires', model: 'sketch' };
  const { idea } = JSON.parse((await b.call('POST', '/api/ideas', body)).text);
  app.store.ideas.update(idea.id, { status: 'generating' });
  // ui/pages.tsx long-polls; where the server answers at once (this queue cannot be watched), it asks after 2 s, then
  // 1.5× as long each time, up to 10 s; ready after 60 s here. (models-api.test.js holds the long poll itself.)
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
  await b.load('/looks', { shell: false, view: 'js/ui/pages.tsx', api: ['/api/looks?scope=mine'] });
  await b.load('/gallery', { shell: false, view: 'js/ui/pages.tsx', api: ['/api/looks?scope=gallery'] });
  const listed = b.total(lists);
  for (const scope of ['mine', 'gallery']) {
    const { looks } = JSON.parse((await b.fetch(`/api/looks?scope=${scope}`)).text);
    assert.equal(looks.length, 12);
    assert.ok(looks.every((l) => !('layers' in l) && l.layerCount === 3), 'no layers in a list');
  }
  console.info(`${polls} polls over 60 s: ${kb(poll.bytes)}; My looks + Gallery: ${kb(listed.bytes)}; `
    + `the whole session ${kb(b.total().bytes)}`);
  assert.ok(listed.bytes <= 8 * KB, kb(listed.bytes));
});
