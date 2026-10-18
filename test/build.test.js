// The app as Vite builds it (vite.config.js), served by src/static.js: the shell runs under the app CSP with no
// inline script, every asset has a content-hashed name kept for a year, the sandbox page carries everything it runs
// (its CSP loads nothing) and its Worker renders, and the gzipped budgets hold. Also the JSON API on the wire.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import vm from 'node:vm';
import zlib from 'node:zlib';

import { createServer } from '../src/app.js';
import { CACHE_IMMUTABLE, CACHE_PAGE, CSP_APP, CSP_SANDBOX } from '../src/static.js';
import { builtApp } from './fixtures/build.js';

const KB = 1024;
const BUDGET = { total: 165 * KB, login: 40 * KB }; // CONTRIBUTING "Performance budgets"
const LOGIN_VIEW = 'js/ui/auth.js';                  // main.js imports it at once for a signed-out visitor
const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
let dist, manifest, dir, app, base;

/** GET with raw headers back and the body decoded. */
function get(p, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(`${base}${p}`, { headers }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(parts);
        const enc = res.headers['content-encoding'];
        const body = enc === 'br' ? zlib.brotliDecompressSync(raw) : enc === 'gzip' ? zlib.gunzipSync(raw) : raw;
        resolve({ status: res.statusCode, headers: res.headers, text: body.toString('utf8'), raw });
      });
    }).on('error', reject);
  });
}
const gz = (file) => zlib.gzipSync(readFileSync(path.join(dist, file)), { level: 9 }).length;
const kb = (n) => `${(n / KB).toFixed(1)} KB`;

before(async () => {
  dist = await builtApp();
  manifest = JSON.parse(readFileSync(path.join(dist, '.vite/manifest.json'), 'utf8'));
  dir = await mkdtemp(path.join(tmpdir(), 'studio-build-'));
  app = await createServer({ dataDir: dir, distDir: dist, generator: { enqueue() {} }, log: quiet });
  base = `http://127.0.0.1:${(await app.listen(0)).port}`;
});
after(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe('the built app', () => {
  test('the shell: no inline script, every file it names hashed under /assets/, revalidated', async () => {
    const r = await get('/studio');
    assert.equal(r.headers['cache-control'], CACHE_PAGE);
    assert.equal(r.headers['content-security-policy'], CSP_APP);
    const scripts = [...r.text.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
    assert.ok(scripts.length && scripts.every((attrs) => /\bsrc="\/assets\//.test(attrs)), scripts.join(' | '));
    const urls = [...r.text.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    for (const url of urls) assert.match(url, /^\/assets\/[\w.-]+-[\w-]{8}\.\w+$/);
    assert.equal((await get('/studio', { 'if-none-match': r.headers.etag })).status, 304);
  });

  test('assets are kept for a year, compressed; the views and their styles load on first use', async () => {
    const studio = manifest['js/ui/studio.js'];
    assert.ok(studio?.isDynamicEntry && studio.css?.length, 'the Studio is its own chunk, with its own styles');
    for (const file of [studio.file, ...studio.css, manifest['data/rig.json'].file]) {
      const r = await get(`/${file}`, { 'accept-encoding': 'br, gzip' });
      assert.equal(r.status, 200, file);
      assert.equal(r.headers['cache-control'], CACHE_IMMUTABLE, file);
      assert.equal(r.headers['content-encoding'], 'br', file);
      assert.equal(r.headers['content-security-policy'], CSP_APP, file);
    }
    assert.equal((await get('/.vite/manifest.json')).status, 404, 'dotfiles are never served');
  });

  test('the sandbox page loads nothing, has its CSP, and its Worker renders a frame', async () => {
    const [file] = manifest['js/ui/studio.js'].assets.filter((f) => /sandbox-[\w-]+\.html$/.test(f));
    const r = await get(`/${file}`);
    assert.equal(r.headers['content-security-policy'], CSP_SANDBOX);
    assert.equal(r.headers['cache-control'], CACHE_IMMUTABLE);
    assert.ok(!/\b(?:src|href)\s*=|@import|url\(|\/\*@[A-Z]+@\*\//.test(r.text), 'nothing to load, no marker left');
    const blocks = [...r.text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.deepEqual(blocks.map((m) => m[1]), [' type="text/x-folly-worker" id="pattern-worker"', '']);
    for (const [, , script] of blocks) {
      assert.ok(script.length > 1000, 'the Worker and the relay are inlined');
      assert.match(script, /^\(function\s*\(\)\s*\{\s*"use strict";[\s\S]*\}\)\(\);?\s*$/, 'strict, no globals');
    }
    // The Worker as the relay starts it: one classic script, here in a realm of its own with a stand-in `self`.
    const out = [];
    let onMessage;
    const self = { postMessage: (m) => out.push(m), addEventListener: (type, fn) => { onMessage = fn; } };
    vm.runInNewContext(blocks[0][2], { self, performance, console });
    const rig = JSON.parse(readFileSync(new URL('../public/data/rig.json', import.meta.url), 'utf8'));
    const code = readFileSync(new URL('../public/patterns/aurora.js', import.meta.url), 'utf8');
    onMessage({ data: { type: 'init', rig, library: [] } });
    onMessage({ data: { type: 'look', layers: [{ id: 'a', code, groups: [rig.groups[0].id], level: 1 }] } });
    onMessage({ data: { type: 'frame', seq: 1, t: 2.5 } });
    assert.deepEqual(out.map((m) => m.type), ['ready', 'compiling', 'compiled', 'frame']);
    assert.equal(out[2].layers[0].ok, true, out[2].layers[0].error);
    const { rgb, errors } = out[3];
    assert.equal(rgb.length, rig.count * 3);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.ok(rgb.some((v) => v > 0), 'something is lit');
  });

  test(`gzipped, the app is within ${BUDGET.total / KB} KB and the login page ${BUDGET.login / KB} KB`, (t) => {
    const files = readdirSync(path.join(dist, 'assets')).filter((f) => /\.(?:js|css|html)$/.test(f));
    const total = files.reduce((n, f) => n + gz(`assets/${f}`), 0);
    // The login page: the shell, its entry with what that imports, and the sign-in view with what it imports.
    const login = new Set(['index.html']);
    const visit = (key) => {
      const e = manifest[key];
      if (!e || login.has(e.file)) return;
      for (const f of [e.file, ...e.css || []]) login.add(f);
      for (const k of e.imports || []) visit(k);
    };
    visit('index.html');
    visit(LOGIN_VIEW);
    const loginBytes = [...login].reduce((n, f) => n + gz(f), 0);
    t.diagnostic(`app ${kb(total)} gz in ${files.length} files; login page ${kb(loginBytes)} gz in ${login.size}`);
    assert.ok(total <= BUDGET.total, `the app is ${kb(total)} gzipped > ${kb(BUDGET.total)}`);
    assert.ok(loginBytes <= BUDGET.login, `the login page loads ${kb(loginBytes)} gzipped > ${kb(BUDGET.login)}`);
  });
});

describe('the JSON API on the wire', () => {
  let cookie;
  before(async () => {
    const r = await fetch(`${base}/api/signup`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'wire', password: 'correct horse' }) });
    cookie = r.headers.getSetCookie()[0].split(';')[0];
  });

  test('large bodies go br or gzip, small ones plain; one ETag for every encoding', async () => {
    const code = `function pixel(p, t) { return [p.x, p.y, p.z]; }\n// ${'a quiet comment '.repeat(40)}`;
    const look = await fetch(`${base}/api/looks`, { method: 'POST', headers: { cookie, 'content-type':
      'application/json' }, body: JSON.stringify({ title: 'Long', layers: [{ code }, { code }] }) })
      .then((r) => r.json());
    const url = `/api/looks/${look.look.id}`;
    const br = await get(url, { cookie, 'accept-encoding': 'gzip, br' });
    const gz = await get(url, { cookie, 'accept-encoding': 'gzip' });
    const plain = await get(url, { cookie });
    assert.equal(br.headers['content-encoding'], 'br');
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.ok(br.raw.length < plain.raw.length / 2, `${br.raw.length} of ${plain.raw.length}`);
    assert.equal(br.text, plain.text);
    assert.equal(br.headers.vary, 'Accept-Encoding');
    assert.equal(br.headers.etag, plain.headers.etag);
    assert.equal((await get(url, { cookie, 'accept-encoding': 'br', 'if-none-match': gz.headers.etag })).status, 304);
    const me = await get('/api/me', { cookie, 'accept-encoding': 'br' });
    assert.equal(me.headers['content-encoding'], undefined, 'not worth it under 1 KB');
  });

  test('the ideas list and an idea revalidate: a poll of an unchanged idea is an empty 304', async () => {
    const { idea } = await fetch(`${base}/api/ideas`, { method: 'POST', headers: { cookie,
      'content-type': 'application/json' }, body: JSON.stringify({ text: 'embers rising' }) }).then((r) => r.json());
    for (const url of ['/api/ideas', `/api/ideas/${idea.id}`]) {
      const first = await get(url, { cookie });
      assert.equal(first.headers['cache-control'], 'private, no-cache');
      const again = await get(url, { cookie, 'if-none-match': first.headers.etag });
      assert.equal(again.status, 304, url);
      assert.equal(again.raw.length, 0);
      app.store.ideas.update(idea.id, { status: 'generating' });
      assert.equal((await get(url, { cookie, 'if-none-match': first.headers.etag })).status, 200, `${url} changed`);
      app.store.ideas.update(idea.id, { status: 'queued' });
    }
  });
});
