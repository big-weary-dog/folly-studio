// What a Studio visit moves over the wire, against the real server and the real public/ files. A cold
// load (the shell, its CSS and modules, the Studio's lazy modules and styles, the sandbox, cathedral.json
// and the API calls) stays under 250 KB compressed; a warm reload moves no bodies: every response is
// still fresh or answers its ETag with a 304.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import zlib from 'node:zlib';

import { createServer } from '../src/app.js';

const COLD_BUDGET = 250 * 1024;
const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
let app, dir, port, cookie;

/** GET as a browser would, counting the bytes on the wire (status line, headers, compressed body). */
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: url, headers: { cookie, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        // "name: value\r\n" per header, and the blank line after them
        const head = `HTTP/1.1 ${res.statusCode}\r\n\r\n`.length + res.rawHeaders.reduce((n, v) => n + v.length + 2, 0);
        const enc = res.headers['content-encoding'];
        const body = enc === 'br' ? zlib.brotliDecompressSync(raw) : enc === 'gzip' ? zlib.gunzipSync(raw) : raw;
        resolve({ url, status: res.statusCode, headers: res.headers, wire: head + raw.length, bodyBytes: raw.length,
          text: body.toString('utf8') });
      });
    });
    req.on('error', reject);
  });
}

/** Everything a cold visit to /studio fetches, in the order a browser finds it. */
async function coldStudio(encoding) {
  const seen = new Map();
  const fetchOnce = async (url) => {
    if (!seen.has(url)) seen.set(url, await get(url, { 'accept-encoding': encoding }));
    return seen.get(url);
  };
  const shell = await fetchOnce('/studio');
  const refs = [...shell.text.matchAll(/<(?:link|script)\b[^>]*?\b(?:href|src)="(\/[^"]+)"/g)].map((m) => m[1]);
  const modules = [];
  for (const url of refs) {
    const r = await fetchOnce(url);
    if (url.endsWith('.js')) modules.push(r);
  }
  // Static imports, the Studio route's own module, and the styles a module asks for with stylesheet().
  for (let i = 0; i < modules.length; i++) {
    const { url, text } = modules[i];
    const deps = [...text.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s*'(\.{1,2}\/[^']+)'/gm)].map((m) => m[1]);
    if (url === '/js/main.js') deps.push('./ui/studio.js');
    for (const dep of deps) {
      const next = new URL(dep, `http://x${url}`).pathname;
      if (!seen.has(next)) modules.push(await fetchOnce(next));
    }
    for (const m of text.matchAll(/stylesheet\('(\/css\/[^']+)'\)/g)) await fetchOnce(m[1]);
  }
  for (const url of ['/sandbox.html', '/data/cathedral.json', '/api/me', '/api/library']) await fetchOnce(url);
  return [...seen.values()];
}

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'studio-transfer-'));
  app = await createServer({ dataDir: dir, generator: { enqueue() {} }, log: quiet });
  port = (await app.listen(0)).port;
  const res = await fetch(`http://127.0.0.1:${port}/api/signup`, { method: 'POST', headers: {
    'content-type': 'application/json' }, body: JSON.stringify({ username: 'wire', password: 'correct horse' }) });
  assert.equal(res.status, 201);
  cookie = /studio_session=[^;]+/.exec(res.headers.get('set-cookie'))[0];
});
after(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

for (const encoding of ['br, gzip', 'gzip']) {
  test(`a cold Studio load is under 250 KB on the wire (${encoding})`, async (t) => {
    const all = await coldStudio(encoding);
    for (const r of all) assert.equal(r.status, 200, r.url);
    assert.ok(all.some((r) => r.url === '/js/ui/studio.js') && all.some((r) => r.url === '/data/cathedral.json'));
    const total = all.reduce((n, r) => n + r.wire, 0);
    const cathedral = all.find((r) => r.url === '/data/cathedral.json').wire;
    t.diagnostic(`${all.length} responses, ${(total / 1024).toFixed(1)} KB (cathedral.json ${(cathedral / 1024)
      .toFixed(1)} KB)`);
    assert.ok(total <= COLD_BUDGET, `${(total / 1024).toFixed(1)} KB > 250 KB`);
  });
}

test('a warm reload moves no bodies: fresh from cache, or a 304 for its ETag', async (t) => {
  const all = await coldStudio('br, gzip');
  let fresh = 0, wire = 0;
  for (const r of all) {
    const cc = r.headers['cache-control'] || '';
    if (Number(/max-age=(\d+)/.exec(cc)?.[1]) > 0 && !/no-cache|no-store/.test(cc)) fresh++;
    // Fresh or not, every response revalidates to an empty 304 (a reload after max-age, or a hard one).
    assert.ok(r.headers.etag, `${r.url} has an ETag`);
    const again = await get(r.url, { 'accept-encoding': 'br, gzip', 'if-none-match': r.headers.etag });
    assert.equal(again.status, 304, `${r.url} revalidates to 304`);
    assert.equal(again.bodyBytes, 0);
    if (!/max-age=[1-9]/.test(cc) || /no-cache/.test(cc)) wire += again.wire;
  }
  t.diagnostic(`${fresh} of ${all.length} fresh from cache; the other ${all.length - fresh} are 304s, `
    + `${(wire / 1024).toFixed(1)} KB of headers`);
});
