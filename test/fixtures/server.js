// Shared by the server tests: fixture public (sources) and dist (built) dirs in a temp folder, apps on port 0 with
// a stand-in queue and render box, and a cookie-keeping JSON client.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll } from 'vitest';

import { writeFseq } from '../../public/js/fseq.ts';
import { createServer } from '../../src/app.ts';

/** { tmp, publicDir, distDir } once useFixture()'s before hook has run. */
export const fx = {};
export function useFixture() {
  beforeAll(async () => {
    fx.tmp = await mkdtemp(path.join(tmpdir(), 'studio-server-test-'));
    fx.publicDir = path.join(fx.tmp, 'public');
    fx.distDir = path.join(fx.tmp, 'dist');
    await writeFixture(fx.publicDir);
    await writeBuilt(fx.distDir);
    await writeFile(path.join(fx.tmp, 'secret.txt'), 'TOP SECRET');
  });
  afterAll(() => rm(fx.tmp, { recursive: true, force: true }));
}

export const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
export const EXPECTED_APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
  + "img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; "
  + "base-uri 'none'; frame-ancestors 'none'";
export const EXPECTED_SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; "
  + 'sandbox allow-scripts';
export const SANDBOX_PAGE = '/assets/sandbox-0123abcd.html';
export const PIXEL = 'function pixel(p, t, P) { return [p.x, p.y, p.z]; }';

const RIG = JSON.stringify({
  rig: 1, count: 2, output: { universes: 1, channelsPerUniverse: 510 }, bounds: { min: [0, 0, 0], max: [0, 1, 0] },
  fixtures: [{ id: 'z', zone: 'z', kind: 'strip', start: 0, count: 2 }],
  pixels: { universe: [1, 1], channel: [1, 4], pos: [0, 0, 0, 0, 1, 0] },
  groups: [{ id: 'cathedral', name: 'Cathedral', parent: null, zones: ['z'] }],
});

/** What a build leaves in dist/: the shell, files, a hashed sandbox page, and a dotfile that must not be served. */
async function writeBuilt(dir) {
  await mkdir(path.join(dir, 'js'), { recursive: true });
  await mkdir(path.join(dir, 'data'), { recursive: true });
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>Folly Studio</title><p>APP SHELL</p>');
  await writeFile(path.join(dir, SANDBOX_PAGE), '<!doctype html><script>window.ok = 1;</script>');
  await writeFile(path.join(dir, 'js', 'main.js'), 'console.log("main");');
  await writeFile(path.join(dir, 'app.css'), 'body { color: red }');
  await writeFile(path.join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(path.join(dir, 'data', 'rig.json'), RIG);
  await writeFile(path.join(dir, '.secret-dotfile'), 'DOTFILE');
}

/** The sources the server reads: the library and the rig. */
async function writeFixture(dir) {
  await mkdir(path.join(dir, 'patterns'), { recursive: true });
  await mkdir(path.join(dir, 'data'), { recursive: true });
  await writeFile(
    path.join(dir, 'patterns', 'index.json'),
    JSON.stringify([
      { name: 'embers', title: 'Rising embers', summary: 'Warm sparks', tags: ['warm'] },
      { name: 'missing', title: 'No file' },
      { name: '../evil', title: 'Traversal' },
    ]),
  );
  await writeFile(path.join(dir, 'patterns', 'embers.js'), `// Rising embers\n${PIXEL}\n`);
  await writeFile(path.join(dir, 'data', 'rig.json'), RIG);
}

/**
 * A stand-in render box (the real one, under bubblewrap, is test/bake.test.js): two seconds of
 * frames for the fixture's two LEDs, strobing at 10 Hz when the code says STROBE, else steady.
 */
export function fakeBox() {
  return {
    renders: 0,
    config: { seconds: 2 },
    probe: async () => ({ ok: true }),
    async render({ layers }) {
      this.renders++;
      const strobe = layers.some((l) => /STROBE/.test(l.code));
      const data = new Uint8Array(80 * 6);
      for (let f = 0; f < 80; f++) data.fill(strobe && Math.floor(f / 2) % 2 ? 0 : 200, f * 6, f * 6 + 6);
      return { bytes: Buffer.from(writeFseq({ frames: 80, data, ranges: [[0, 6]] })), boxStats: { untrusted: true,
        reported: { ok: true } } };
    },
  };
}

export function fakeQueue() {
  return { enqueued: [], enqueue(idea) { this.enqueued.push(idea); }, async idle() {} };
}

/** Passwords at a test's cost: at OWASP's, each hash takes half a second (test/auth.test.ts holds the real one). */
const CHEAP = Object.freeze({ N: 1024, r: 8, p: 1 });

export async function startApp(opts = {}) {
  const app = await createServer({ publicDir: fx.publicDir, distDir: fx.distDir, generator: fakeQueue(),
    generatorName: 'test', log: quiet, scrypt: CHEAP, models: { env: {} }, customCode: true, ...opts });
  const addr = await app.listen(0, '127.0.0.1');
  app.base = `http://127.0.0.1:${addr.port}`;
  app.port = addr.port;
  return app;
}

/** A tiny cookie-keeping JSON client. */
export function client(app) {
  let cookie = '';
  async function req(method, p, body, headers = {}) {
    const h = { ...headers };
    if (cookie && !('cookie' in h)) h.cookie = cookie;
    if (method !== 'GET' && !('content-type' in h)) h['content-type'] = 'application/json';
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const res = await fetch(app.base + p, { method, headers: h, body: payload });
    const setCookie = res.headers.getSetCookie();
    for (const c of setCookie) {
      const m = /^studio_session=([^;]*)/.exec(c);
      if (m) cookie = m[1] ? `studio_session=${m[1]}` : '';
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, headers: res.headers, json, text, setCookie };
  }
  return {
    req,
    get: (p, h) => req('GET', p, undefined, h),
    post: (p, b, h) => req('POST', p, b ?? {}, h),
    put: (p, b, h) => req('PUT', p, b, h),
    del: (p, h) => req('DELETE', p, undefined, h),
    get cookie() {
      return cookie;
    },
    set cookie(v) {
      cookie = v;
    },
  };
}

export async function signup(app, username, password = 'correct horse') {
  const c = client(app);
  const r = await c.post('/api/signup', { username, password });
  assert.equal(r.status, 201, `signup ${username}: ${r.text}`);
  c.user = r.json.user;
  return c;
}

/** Raw GET with an unnormalized path (fetch would collapse ../, and send Cache-Control: no-cache with an ETag). */
export function rawGet(port, rawPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET', headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    r.end();
  });
}

export const layer = (extra = {}) => ({ id: 'l1', title: 'Sea', code: PIXEL, groups: ['cathedral'], blend: 'add',
  level: 1, params: { speed: 0.4 }, ...extra });
