// Static serving: compression (br / gzip) with an in-memory cache keyed by mtime, ETag
// revalidation, cache headers, the sandbox page and its CSP.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import {
  createStatic, applySecurityHeaders, pickEncoding, acceptsEncoding, etagMatches,
  CSP_SANDBOX, CACHE_PAGE, CACHE_ASSET,
} from '../src/static.js';

const quiet = { info() {}, warn() {}, error() {} };
const BIG_JS = `// a module big enough to compress\n${
  'export const lights = ["ruby", "sapphire", "amber", "emerald"];\n'.repeat(80)}`;
const CORE = `export function renderFrame() { return '</script>'; }\n${'// stdlib\n'.repeat(100)}`;

let dir, server, base;

/** GET with raw headers back and the body undecoded (fetch would decode it). */
function get(p, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${p}`, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studio-static-'));
  await mkdir(path.join(dir, 'js'), { recursive: true });
  await mkdir(path.join(dir, 'data'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'),
    `<!doctype html><title>Folly Studio</title>${'<p>APP SHELL</p>'.repeat(60)}`);
  await writeFile(path.join(dir, 'sandbox.html'),
    `<!doctype html><script type="text/x-core">/*@CORE@*/</script>${'<!-- relay -->'.repeat(40)}`);
  await writeFile(path.join(dir, 'js', 'pattern-core.js'), CORE);
  await writeFile(path.join(dir, 'js', 'sandbox-worker.js'), "import { renderFrame } from './pattern-core.js';\n");
  await writeFile(path.join(dir, 'js', 'big.js'), BIG_JS);
  await writeFile(path.join(dir, 'js', 'tiny.js'), 'export const a = 1;\n');
  await writeFile(path.join(dir, 'data', 'rig.json'), JSON.stringify({ pos: Array.from({ length: 3000 }, (_,
    i) => +(i * 0.137).toFixed(3)) }));
  await writeFile(path.join(dir, 'pic.png'), Buffer.alloc(4096, 7));
  const serve = createStatic({ publicDir: dir, log: quiet });
  server = http.createServer((req, res) => {
    applySecurityHeaders(res);
    serve(req, res, new URL(req.url,
      'http://x').pathname).catch((err) => { res.writeHead(500); res.end(String(err)); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
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
    assert.equal(pickEncoding('*;q=0, gzip'), 'gzip');
    assert.equal(acceptsEncoding('GZIP;Q=1', 'gzip'), true);
    assert.equal(acceptsEncoding('gzip;q=0', 'gzip'), false);
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
    const r = await get('/js/big.js', { 'accept-encoding': 'gzip' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-encoding'], 'gzip');
    assert.equal(r.headers.vary, 'Accept-Encoding');
    assert.equal(+r.headers['content-length'], r.body.length);
    assert.ok(r.body.length < BIG_JS.length / 4, `${r.body.length} bytes`);
    assert.equal(zlib.gunzipSync(r.body).toString(), BIG_JS);
    assert.match(r.headers['content-type'], /^text\/javascript/);
  });

  test('brotli when accepted', async () => {
    const r = await get('/data/rig.json', { 'accept-encoding': 'gzip, deflate, br' });
    assert.equal(r.headers['content-encoding'], 'br');
    const json = JSON.parse(zlib.brotliDecompressSync(r.body).toString());
    assert.equal(json.pos.length, 3000);
  });

  test('identity without Accept-Encoding; tiny and binary files are never encoded', async () => {
    const plain = await get('/js/big.js');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.body.toString(), BIG_JS);
    const tiny = await get('/js/tiny.js', { 'accept-encoding': 'gzip, br' });
    assert.equal(tiny.headers['content-encoding'], undefined);
    assert.equal(tiny.headers.vary, undefined);
    const png = await get('/pic.png', { 'accept-encoding': 'gzip, br' });
    assert.equal(png.headers['content-encoding'], undefined);
    assert.equal(png.body.length, 4096);
  });

  test('ETag + If-None-Match answers 304 without a body, for any encoding', async () => {
    const r = await get('/js/big.js', { 'accept-encoding': 'gzip' });
    const etag = r.headers.etag;
    assert.match(etag, /^W\/"[^"]+"$/);
    const again = await get('/js/big.js', { 'accept-encoding': 'br', 'if-none-match': etag });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    assert.equal(again.headers.etag, etag);
    assert.equal(again.headers['cache-control'], CACHE_ASSET);
    const other = await get('/js/big.js', { 'if-none-match': 'W/"nope"' });
    assert.equal(other.status, 200);
  });

  test('HTML and the sandbox revalidate every time; assets may be reused briefly', async () => {
    assert.equal((await get('/')).headers['cache-control'], CACHE_PAGE);
    assert.equal((await get('/studio/abc')).headers['cache-control'], CACHE_PAGE);
    assert.equal((await get('/sandbox.html')).headers['cache-control'], CACHE_PAGE);
    assert.equal(CACHE_PAGE, 'no-cache');
    assert.match(CACHE_ASSET, /max-age=\d+/);
    assert.equal((await get('/js/big.js')).headers['cache-control'], CACHE_ASSET);
  });

  test('HEAD sends the headers only', async () => {
    const r = await get('/js/big.js', { 'accept-encoding': 'gzip' }, 'HEAD');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 0);
    assert.equal(r.headers['content-encoding'], 'gzip');
    assert.ok(+r.headers['content-length'] > 0);
  });

  test('a changed file gets a new ETag and new compressed bytes', async () => {
    const file = path.join(dir, 'js', 'big.js');
    const first = await get('/js/big.js', { 'accept-encoding': 'gzip' });
    const changed = BIG_JS.replace(/ruby/g, 'rose');
    await writeFile(file, changed);
    const later = new Date(Date.now() + 5000);
    await utimes(file, later, later);
    const second = await get('/js/big.js', { 'accept-encoding': 'gzip' });
    assert.notEqual(second.headers.etag, first.headers.etag);
    assert.equal(zlib.gunzipSync(second.body).toString(), changed);
    const stale = await get('/js/big.js', { 'if-none-match': first.headers.etag });
    assert.equal(stale.status, 200);
  });

  test('the sandbox: core inlined, CSP allows blob workers only, compressed and revalidated', async () => {
    const r = await get('/sandbox.html', { 'accept-encoding': 'gzip' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-security-policy'], CSP_SANDBOX);
    assert.equal(CSP_SANDBOX,
      "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; sandbox allow-scripts");
    assert.equal(r.headers['content-encoding'], 'gzip');
    const html = zlib.gunzipSync(r.body).toString();
    assert.ok(!html.includes('/*@CORE@*/'));
    assert.ok(html.includes("return '<\\/script>';"), 'a </script> in the core cannot end the element');
    const same = await get('/sandbox.html', { 'if-none-match': r.headers.etag });
    assert.equal(same.status, 304);
    assert.equal(same.headers['content-security-policy'], CSP_SANDBOX);

    // editing the core changes the page
    const coreFile = path.join(dir, 'js', 'pattern-core.js');
    await writeFile(coreFile, CORE.replace('renderFrame', 'renderFrame2'));
    const later = new Date(Date.now() + 5000);
    await utimes(coreFile, later, later);
    const next = await get('/sandbox.html', { 'if-none-match': r.headers.etag });
    assert.equal(next.status, 200);
    assert.ok(next.body.toString().includes('renderFrame2'));
  });
});
