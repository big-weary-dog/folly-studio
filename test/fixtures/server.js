// Shared by the server tests: fixture public (sources) and dist (built) dirs in a temp folder, and apps serving them.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll } from 'vitest';

import { RIG_FILES } from '../../src/rig-choice.ts';
import { serve } from './app.js';

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

export const EXPECTED_APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
  + "img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; "
  + "base-uri 'none'; frame-ancestors 'none'";
export const EXPECTED_SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; "
  + 'sandbox allow-scripts';
export const SANDBOX_PAGE = '/assets/sandbox-0123abcd.html';
export const PIXEL = 'function pixel(p, t, P) { return [p.x, p.y, p.z]; }';
/** The fixture library's embers.js: library code, so it saves. */
export const EMBERS = `// Rising embers\n${PIXEL}\n`;

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
  await writeFile(path.join(dir, 'patterns', 'embers.js'), EMBERS);
  await writeFile(path.join(dir, 'data', RIG_FILES.folly), RIG);   // the server's default rig
}

/** An app serving the fixture's folders. */
export const startApp = (opts = {}) => serve({ publicDir: fx.publicDir, distDir: fx.distDir, ...opts });

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

export const layer = (extra = {}) => ({ id: 'l1', title: 'Sea', ref: 'embers', code: EMBERS, groups: ['cathedral'],
  blend: 'add', level: 1, params: { speed: 0.4 }, ...extra });
