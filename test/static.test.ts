// The built app (dist/) as src/static.ts serves it: br or gzip from the copies the build precompresses
// (tools/vite-compress.ts), ETag revalidation, cache headers (content-hashed assets kept a year), the sandbox page's
// CSP, the shell for SPA routes, and what is never served.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { createServer } from '../src/app.ts';
import { etagMatches, pickEncoding } from '../src/http.ts';
import { CACHE_ASSET, CACHE_IMMUTABLE, CACHE_PAGE, CSP_APP, CSP_SANDBOX } from '../src/static.ts';
import { precompress } from '../tools/vite-compress.ts';

const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
const BIG_JS = `// a module big enough to compress\n${
  'export const lights = ["ruby", "sapphire", "amber", "emerald"];\n'.repeat(80)}`;
const SANDBOX = `<!doctype html><script>${'/* relay */'.repeat(100)}</script>`;
const FILES: Record<string, string | Buffer> = {
  'index.html': `<!doctype html><title>Folly Studio</title>${'<p>APP SHELL</p>'.repeat(60)}`,
  'assets/sandbox-Ab12Cd34.html': SANDBOX, 'assets/big-Ab12Cd34.js': BIG_JS,
  'assets/tiny-Ab12Cd34.js': 'export const a = 1;\n', 'big.js': BIG_JS, 'pic.png': Buffer.alloc(4096, 7),
  'assets/rig-Ab12Cd34.json': JSON.stringify({ pos: Array.from({ length: 3000 }, (_, i) => +(i * 0.137).toFixed(3)) }),
  '.vite/manifest.json': '{}',
};
let dir: string, app: Awaited<ReturnType<typeof createServer>>, port: number;

/** What the build does after writing `files`: their .br and .gz copies. */
const packed = (files: string[]) => (precompress() as { writeBundle: (o: object, b: object) => Promise<void> })
  .writeBundle({ dir }, Object.fromEntries(files.map((f) => [f, {}])));

/** A GET with exactly these headers, the body undecoded. */
function get(p: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<{ status: number, headers: http.IncomingHttpHeaders, body: Buffer }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studio-static-'));
  for (const [f, body] of Object.entries(FILES)) {
    await mkdir(path.dirname(path.join(dir, f)), { recursive: true });
    await writeFile(path.join(dir, f), body);
  }
  await packed(Object.keys(FILES));
  app = await createServer({ dataDir: path.join(dir, '.data'), distDir: dir, generator: { enqueue() {} }, log: quiet });
  port = (await app.listen(0)).port;
});

afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe('encoding negotiation', () => {
  test('prefers br, then gzip, and honours q=0', () => {
    assert.equal(pickEncoding('gzip, deflate, br'), 'br');
    assert.equal(pickEncoding('gzip, deflate'), 'gzip');
    assert.equal(pickEncoding('br;q=0, gzip;q=0.5'), 'gzip');
    assert.equal(pickEncoding('identity'), null);
    assert.equal(pickEncoding(''), null);
    assert.equal(pickEncoding(undefined), null);
    assert.equal(pickEncoding('*'), 'br');
    assert.equal(pickEncoding('GZIP;Q=1', ['gzip']), 'gzip');
    assert.equal(pickEncoding('gzip;q=0', ['gzip']), null);
  });

  test('ETag matching is weak and takes lists and *', () => {
    assert.ok(etagMatches('W/"abc"', 'W/"abc"'));
    assert.ok(etagMatches('"abc"', 'W/"abc"'));
    assert.ok(etagMatches('W/"x", W/"abc"', 'W/"abc"'));
    assert.ok(etagMatches('*', 'W/"abc"'));
    assert.ok(!etagMatches('W/"abd"', 'W/"abc"'));
    assert.ok(!etagMatches(undefined, 'W/"abc"'));
  });
});

describe('serving', () => {
  test('gzip when that is all the client takes, with Vary and a correct body', async () => {
    const r = await get('/assets/big-Ab12Cd34.js', { 'accept-encoding': 'gzip' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-encoding'], 'gzip');
    assert.match(String(r.headers.vary), /accept-encoding/i);
    assert.equal(+r.headers['content-length']!, r.body.length);
    assert.ok(r.body.length < BIG_JS.length / 4, `${r.body.length} bytes`);
    assert.equal(zlib.gunzipSync(r.body).toString(), BIG_JS);
    assert.match(String(r.headers['content-type']), /^text\/javascript/);
    assert.equal(r.headers['content-security-policy'], CSP_APP);
  });

  test('brotli when accepted', async () => {
    const r = await get('/assets/rig-Ab12Cd34.json', { 'accept-encoding': 'gzip, deflate, br' });
    assert.equal(r.headers['content-encoding'], 'br');
    assert.match(String(r.headers['content-type']), /^application\/json/);
    assert.equal(JSON.parse(zlib.brotliDecompressSync(r.body).toString()).pos.length, 3000);
  });

  test('identity without Accept-Encoding; tiny and binary files are never encoded', async () => {
    const plain = await get('/assets/big-Ab12Cd34.js');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.body.toString(), BIG_JS);
    const tiny = await get('/assets/tiny-Ab12Cd34.js', { 'accept-encoding': 'gzip, br' });
    assert.equal(tiny.headers['content-encoding'], undefined);
    const png = await get('/pic.png', { 'accept-encoding': 'gzip, br' });
    assert.equal(png.headers['content-encoding'], undefined);
    assert.equal(png.body.length, 4096);
  });

  test('ETag + If-None-Match answers 304 without a body; each encoding is a representation of its own', async () => {
    const r = await get('/assets/big-Ab12Cd34.js', { 'accept-encoding': 'gzip' });
    assert.match(String(r.headers.etag), /^W\/"[^"]+"$/);
    const again = await get('/assets/big-Ab12Cd34.js', { 'accept-encoding': 'gzip', 'if-none-match': r.headers.etag! });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    assert.equal(again.headers.etag, r.headers.etag);
    assert.equal(again.headers['cache-control'], CACHE_IMMUTABLE);
    const br = await get('/assets/big-Ab12Cd34.js', { 'accept-encoding': 'br', 'if-none-match': r.headers.etag! });
    assert.equal(br.status, 200);
    assert.notEqual(br.headers.etag, r.headers.etag);
    assert.equal((await get('/assets/big-Ab12Cd34.js', { 'if-none-match': 'W/"nope"' })).status, 200);
  });

  test('the shell revalidates every time, content-hashed assets are kept a year, other files briefly', async () => {
    for (const p of ['/', '/studio/abc', '/index.html']) {
      const r = await get(p, { 'accept-encoding': 'br' });
      assert.equal(r.headers['cache-control'], CACHE_PAGE, p);
      assert.match(zlib.brotliDecompressSync(r.body).toString(), /APP SHELL/, p);
      assert.equal(r.headers['content-security-policy'], CSP_APP, p);
    }
    assert.equal(CACHE_PAGE, 'no-cache');
    assert.equal(CACHE_IMMUTABLE, 'public, max-age=31536000, immutable');
    assert.equal((await get('/assets/tiny-Ab12Cd34.js')).headers['cache-control'], CACHE_IMMUTABLE);
    assert.match(CACHE_ASSET, /max-age=\d+/);
    assert.equal((await get('/big.js')).headers['cache-control'], CACHE_ASSET);
  });

  test('the sandbox page: its own CSP, kept a year, compressed', async () => {
    const r = await get('/assets/sandbox-Ab12Cd34.html', { 'accept-encoding': 'gzip' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-security-policy'], CSP_SANDBOX);
    assert.equal(CSP_SANDBOX,
      "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; sandbox allow-scripts");
    assert.equal(r.headers['cache-control'], CACHE_IMMUTABLE);
    assert.equal(r.headers['content-encoding'], 'gzip');
    assert.match(String(r.headers['content-type']), /^text\/html/);
    assert.equal(zlib.gunzipSync(r.body).toString(), SANDBOX);
    const same = await get('/assets/sandbox-Ab12Cd34.html',
      { 'accept-encoding': 'gzip', 'if-none-match': r.headers.etag! });
    assert.equal(same.status, 304);
    assert.equal(same.headers['content-security-policy'], CSP_SANDBOX);
  });

  test('dotfiles (the build manifest), missing files and other methods are refused', async () => {
    assert.equal((await get('/.vite/manifest.json')).status, 404);
    assert.equal((await get('/.vite/')).status, 404);
    assert.equal((await get('/assets/missing-Ab12Cd34.js')).status, 404);
    const post = await get('/assets/big-Ab12Cd34.js', {}, 'POST');
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, 'GET, HEAD');
  });

  test('HEAD sends the headers only', async () => {
    const r = await get('/assets/big-Ab12Cd34.js', { 'accept-encoding': 'gzip' }, 'HEAD');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 0);
    assert.equal(r.headers['content-encoding'], 'gzip');
    assert.ok(+r.headers['content-length']! > 0);
  });

  test('a rebuilt file gets a new ETag and new compressed bytes', async () => {
    const first = await get('/big.js', { 'accept-encoding': 'gzip' });
    const changed = BIG_JS.replace(/ruby/g, 'rose');
    await writeFile(path.join(dir, 'big.js'), changed);
    await packed(['big.js']);
    const later = new Date(Date.now() + 5000);
    for (const f of ['big.js', 'big.js.gz']) await utimes(path.join(dir, f), later, later);
    const second = await get('/big.js', { 'accept-encoding': 'gzip' });
    assert.notEqual(second.headers.etag, first.headers.etag);
    assert.equal(zlib.gunzipSync(second.body).toString(), changed);
    const stale = await get('/big.js', { 'accept-encoding': 'gzip', 'if-none-match': first.headers.etag! });
    assert.equal(stale.status, 200);
  });
});
