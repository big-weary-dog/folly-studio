// Content-hashed static URLs (src/assets.js through src/static.js): the shell's import map and its CSP hash,
// one theme stylesheet, modules' asset literals, immutable caching, stale hashes, changes; and the JSON API's
// compression and revalidation (src/http.js).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import zlib from 'node:zlib';

import { unhashed } from '../src/assets.js';
import { createServer } from '../src/app.js';
import { CACHE_ASSET, CACHE_IMMUTABLE, CSP_APP, CSP_SANDBOX } from '../src/static.js';

const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
const SHELL = `<!doctype html><title>Folly Studio</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/tokens.css">
<link rel="stylesheet" href="/css/base.css">
<script type="module" src="/js/main.js"></script>
<p>APP SHELL</p>`;
const MAIN = "import { h } from './ui/dom.js';\nconst view = () => import('./ui/view.js');\n";
const VIEW = "import { h } from './dom.js';\nawait stylesheet('/css/view.css');\nfetch('/data/map.json');\n"
  + "const frame = '/sandbox.html'; const other = '/css/missing.css';\n";
let dir, app, base;

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
const write = async (rel, text) => {
  await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await writeFile(path.join(dir, rel), text);
};
const importMap = (html) => JSON.parse(/<script type="importmap">([^<]*)<\/script>/.exec(html)[1]).imports;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studio-assets-'));
  await write('public/index.html', SHELL);
  await write('public/favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await write('public/css/tokens.css', ':root { --ruby: #e0115f; }\n');
  await write('public/css/base.css', 'body { color: var(--ruby); }\n');
  await write('public/css/view.css', '.view { color: blue; }\n');
  await write('public/js/main.js', MAIN);
  await write('public/js/ui/dom.js', 'export const h = 1;\n');
  await write('public/js/ui/view.js', VIEW);
  await write('public/js/pattern-core.js', 'export const STDLIB = {};\n');
  await write('public/js/sandbox-worker.js', "import { STDLIB } from './pattern-core.js';\n");
  await write('public/sandbox.html', '<!doctype html><script>/*@CORE@*/</script>');
  await write('public/data/map.json', JSON.stringify({ pos: [1, 2, 3] }));
  app = await createServer({ dataDir: path.join(dir, 'data'), publicDir: path.join(dir, 'public'),
    generator: { enqueue() {} }, log: quiet });
  base = `http://127.0.0.1:${(await app.listen(0)).port}`;
});
after(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe('content-hashed static files', () => {
  test('the shell: hashed URLs, one theme stylesheet, the import map first, its hash in the CSP', async () => {
    const r = await get('/studio');
    assert.equal(r.headers['cache-control'], 'no-cache');
    const map = importMap(r.text);
    assert.deepEqual(Object.keys(map).sort(), ['/js/main.js', '/js/pattern-core.js', '/js/sandbox-worker.js',
      '/js/ui/dom.js', '/js/ui/view.js']);
    for (const [plain, hashed] of Object.entries(map)) assert.equal(unhashed(hashed), plain);
    assert.match(r.text, /<link rel="icon" href="\/favicon\.[0-9a-f]{10}\.svg"/);
    const sheets = [...r.text.matchAll(/rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(sheets.length, 1);
    assert.match(sheets[0], /^\/css\/theme\.[0-9a-f]{10}\.css$/);
    assert.ok(r.text.indexOf('type="importmap"') < r.text.indexOf('<script type="module"'));
    assert.match(r.text, new RegExp(`<script type="module" src="${map['/js/main.js']}">`));
    const text = /<script type="importmap">([^<]*)<\/script>/.exec(r.text)[1];
    const hash = createHash('sha256').update(text).digest('base64');
    assert.equal(r.headers['content-security-policy'],
      CSP_APP.replace("script-src 'self'", `script-src 'self' 'sha256-${hash}'`));
    assert.equal((await get('/studio', { 'if-none-match': r.headers.etag })).status, 304);
  });

  test('hashed URLs are kept for a year; modules name the theme, data and sandbox by theirs', async () => {
    const shell = (await get('/')).text;
    const map = importMap(shell);
    const view = await get(map['/js/ui/view.js'], { 'accept-encoding': 'br' });
    assert.equal(view.headers['cache-control'], CACHE_IMMUTABLE);
    assert.equal(view.headers['content-security-policy'], CSP_APP);
    assert.match(view.text, /^import \{ h \} from '\.\/dom\.js';/, 'imports stay as written: the map resolves them');
    const theme = /href="(\/css\/theme[^"]+)"/.exec(shell)[1];
    assert.ok(view.text.includes(`await stylesheet('${theme}');`), 'a view stylesheet is the theme');
    const data = /fetch\('([^']+)'\)/.exec(view.text)[1];
    const sandbox = /const frame = '([^']+)'/.exec(view.text)[1];
    assert.match(data, /^\/data\/map\.[0-9a-f]{10}\.json$/);
    assert.ok(view.text.includes("'/css/missing.css'"), 'unknown paths are left alone');
    const css = await get(theme);
    assert.equal(css.headers['cache-control'], CACHE_IMMUTABLE);
    assert.match(css.headers['content-type'], /^text\/css/);
    const order = ['--ruby: #e0115f', 'color: var(--ruby)', '.view'].map((s) => css.text.indexOf(s));
    assert.ok(order[0] >= 0 && order[0] < order[1] && order[1] < order[2], 'the shell\'s sheets first, in order');
    assert.deepEqual(JSON.parse((await get(data)).text), { pos: [1, 2, 3] });
    const frame = await get(sandbox);
    assert.equal(frame.headers['content-security-policy'], CSP_SANDBOX);
    assert.equal(frame.headers['cache-control'], CACHE_IMMUTABLE);
    assert.ok(frame.text.includes('export const STDLIB = {};'));
    // Plain URLs still serve the files as they are, briefly cached.
    const plain = await get('/js/ui/view.js');
    assert.equal(plain.text, VIEW);
    assert.equal(plain.headers['cache-control'], CACHE_ASSET);
  });

  test('a stale hash gets the current file, not kept long; a change rehashes only what changed', async () => {
    const map = importMap((await get('/')).text);
    const stale = await get('/js/ui/dom.0123456789.js');
    assert.equal(stale.status, 200);
    assert.equal(stale.headers['cache-control'], CACHE_ASSET);
    assert.equal(stale.text, 'export const h = 1;\n');
    await write('public/js/ui/dom.js', 'export const h = 2;\n');
    const later = new Date(Date.now() + 5000);
    await utimes(path.join(dir, 'public/js/ui/dom.js'), later, later);
    await new Promise((r) => setTimeout(r, 1100)); // the manifest looks at the files at most once a second
    const next = importMap((await get('/')).text);
    assert.notEqual(next['/js/ui/dom.js'], map['/js/ui/dom.js']);
    assert.equal(next['/js/main.js'], map['/js/main.js'], 'importers keep their hash: the map changed, not them');
    assert.equal((await get(next['/js/ui/dom.js'])).text, 'export const h = 2;\n');
    assert.equal((await get(map['/js/ui/dom.js'])).headers['cache-control'], CACHE_ASSET);
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
