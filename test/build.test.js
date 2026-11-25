// The app as Vite builds it (vite.config.js), served by src/static.ts: the shell runs under the app CSP with no
// inline script, every asset has a content-hashed name kept for a year, the pattern worker carries everything it
// runs (its CSP loads nothing) and renders, and the gzipped budgets hold. Also the JSON API on the wire.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { CACHE_IMMUTABLE, CACHE_PAGE, CSP_APP, CSP_WORKER } from '../src/static.ts';
import { builtApp, removeBuiltApp } from './fixtures/build.js';
import { serve, signup } from './fixtures/app.js';
import { libraryCode } from './fixtures/patterns.js';

const KB = 1024;
const BUDGET = { total: 350 * KB, login: 40 * KB }; // CONTRIBUTING "Performance budgets"
const LOGIN_VIEW = 'js/ui/auth.tsx';                  // the shell imports it at once for a signed-out visitor
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

beforeAll(async () => {
  dist = await builtApp();
  manifest = JSON.parse(readFileSync(path.join(dist, '.vite/manifest.json'), 'utf8'));
  dir = await mkdtemp(path.join(tmpdir(), 'studio-build-'));
  app = await serve({ dataDir: dir, distDir: dist, admins: 'wire' });
  base = app.base;
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
  await removeBuiltApp();
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
    const studio = manifest['js/ui/studio.tsx'];
    assert.ok(studio?.isDynamicEntry && studio.css?.length, 'the Studio is its own chunk, with its own styles');
    for (const file of [studio.file, ...studio.css, manifest['data/rig-folly.json'].file]) {
      const r = await get(`/${file}`, { 'accept-encoding': 'br, gzip' });
      assert.equal(r.status, 200, file);
      assert.equal(r.headers['cache-control'], CACHE_IMMUTABLE, file);
      assert.equal(r.headers['content-encoding'], 'br', file);
      assert.equal(r.headers['content-security-policy'], CSP_APP, file);
    }
    assert.equal((await get('/.vite/manifest.json')).status, 404, 'dotfiles are never served');
  });

  test('the pattern worker loads nothing, has its CSP, and renders a frame', async () => {
    const files = readdirSync(path.join(dist, 'assets')).filter((f) => /^sandbox-worker-[\w-]+\.js$/.test(f));
    assert.equal(files.length, 1, files.join(', '));
    const [file] = files;
    const r = await get(`/assets/${file}`);
    assert.equal(r.headers['content-security-policy'], CSP_WORKER);
    assert.equal(r.headers['cache-control'], CACHE_IMMUTABLE);
    assert.ok(!/\bimport\b\s*[({"'`\w*]|importScripts\(/.test(r.text), 'one script: it imports nothing');
    assert.match(r.text, /^\(function\s*\(\)\s*\{[\s\S]*\}\)\(\);?\s*$/, 'its names in its own scope');
    // Here in a realm of its own with a stand-in `self`.
    const out = [];
    let onMessage;
    const self = { postMessage: (m) => out.push(m), addEventListener: (type, fn) => { onMessage = fn; } };
    vm.runInNewContext(r.text, { self, performance, console });
    const rig = JSON.parse(readFileSync(new URL('../public/data/rig-folly.json', import.meta.url), 'utf8'));
    const code = libraryCode('clouds');
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

  test(`gzipped, the app is within ${BUDGET.total / KB} KB and the login page ${BUDGET.login / KB} KB`, () => {
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
    console.info(`app ${kb(total)} gz in ${files.length} files; login page ${kb(loginBytes)} gz in ${login.size}`);
    assert.ok(total <= BUDGET.total, `the app is ${kb(total)} gzipped > ${kb(BUDGET.total)}`);
    assert.ok(loginBytes <= BUDGET.login, `the login page loads ${kb(loginBytes)} gzipped > ${kb(BUDGET.login)}`);
  });
});

describe('the JSON API on the wire', () => {
  let cookie;
  beforeAll(async () => {
    ({ cookie } = await signup(app, 'wire'));
  });

  test('large bodies go br or gzip, small ones plain; one ETag for every encoding', async () => {
    const layer = (id) => ({ id, modules: [{ id: 'a', kind: 'source', ref: 'streaks' }] });   // a read fills its code
    const layers = [layer('l1'), layer('l2')];
    const look = await fetch(`${base}/api/looks`, { method: 'POST', headers: { cookie, 'content-type':
      'application/json' }, body: JSON.stringify({ title: 'Long', layers }) })
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
});
