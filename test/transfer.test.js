// What visits move over the wire, against the real server and the app as Vite builds it (test/fixtures/browser.js
// keeps an HTTP cache the way a browser does). A cold Studio load (the shell, its styles and modules, the
// Studio's lazy modules and styles, the pattern worker, rig.json and the API calls) stays within COLD; a reload, even
// a day later, sends only the shell and the API calls, each a 304; and lists carry no code.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, test } from 'vitest';

import { browser } from './fixtures/browser.js';
import { builtApp, removeBuiltApp } from './fixtures/build.js';
import { serve, signup } from './fixtures/app.js';
import { libraryCode, libraryIndex } from './fixtures/patterns.js';

const KB = 1024;
// Measured on the Folly's rig: 257 KB in 26 requests with br, 294 KB gzip only (HTTP/1.1 headers in full); the
// owner's caps for a desktop-first builder, with room to grow: mindful of size, but no trimming for a KB.
// The rig is 29 KB of that with br (43 KB gzip): the LEDs, and the 3D view's rose cells, floods and scaffold.
const COLD = { 'br, gzip': 360 * KB, gzip: 400 * KB };
const STUDIO = { view: 'js/ui/studio/studio.tsx', api: ['/api/me', '/api/library'] };
// Both rigs ship; the browser fetches the one /api/me names, the Folly's here, never City of Gods' rig.json.
const unfetched = /^\/assets\/rig-(?!folly-)[\w-]{8}\.json$/;
const PLAYA = { view: 'js/playa/renderer.ts', shell: false };   // the 3D view's default mode, imported on show
const kb = (n) => `${(n / KB).toFixed(1)} KB`;
let app, dir, port, cookie, manifest;

beforeAll(async () => {
  const dist = await builtApp();
  manifest = JSON.parse(await readFile(path.join(dist, '.vite/manifest.json'), 'utf8'));
  dir = await mkdtemp(path.join(os.tmpdir(), 'studio-transfer-'));
  app = await serve({ dataDir: dir, distDir: dist, admins: 'wire' });
  port = app.port;
  ({ cookie } = await signup(app, 'wire'));
  // A dozen looks of library code, as a list would show them.
  const user = app.store.users.list()[0];
  const lib = libraryIndex().filter((e) => e.kind !== 'preset');
  for (let i = 0; i < 12; i++) {
    const layers = [0, 1, 2].map((k) => ({ id: `l${k}`, title: 'x', groups: ['cathedral'],
      code: libraryCode(lib[(i + k) % lib.length].name), blend: 'add', level: 1, params: {} }));
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
    const b = browser(port, { encoding, cookie, manifest, unfetched });
    await b.load('/studio', STUDIO);
    await b.load('/studio', PLAYA);
    for (const r of b.log) assert.ok(r.status === 200 || r.status === 'cache', `${r.url}: ${r.status}`);
    const files = b.log.filter((r) => !/^\/(?:studio|api\/)/.test(r.url)).map((r) => r.url);
    for (const url of files) assert.match(url, /^\/assets\/[\w.-]+-[\w-]{8}\.\w+$/, 'by its content-hashed name');
    for (const name of ['studio-*.js', 'studio-*.css', 'rig-folly-*.json', 'sandbox-worker-*.js', 'renderer-*.js']) {
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

test('lists carry metadata, not code', async () => {
  const b = browser(port, { cookie, manifest });
  await b.load('/looks', { view: 'js/ui/gallery/pages.tsx', api: ['/api/me'] });   // the shell and the page's module
  const lists = b.log.length;
  await b.load('/looks', { shell: false, view: 'js/ui/gallery/pages.tsx', api: ['/api/looks?scope=mine'] });
  await b.load('/gallery', { shell: false, view: 'js/ui/gallery/pages.tsx', api: ['/api/looks?scope=gallery'] });
  const listed = b.total(lists);
  for (const scope of ['mine', 'gallery']) {
    const { looks } = JSON.parse((await b.fetch(`/api/looks?scope=${scope}`)).text);
    assert.equal(looks.length, 12);
    assert.ok(looks.every((l) => !('layers' in l) && l.layerCount === 3), 'no layers in a list');
  }
  console.info(`My looks + Gallery: ${kb(listed.bytes)}; the whole session ${kb(b.total().bytes)}`);
  assert.ok(listed.bytes <= 8 * KB, kb(listed.bytes));
});
