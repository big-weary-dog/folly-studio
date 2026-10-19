// The baked-frames routes (src/frames-http.ts, src/frames-cache.ts): streaming chunks under
// immutable content-hash URLs, br / gzip / plain negotiation, who may fetch them, the wait while a
// bake is encoded, compressed .fseq downloads, and folders pruned when their bake goes.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { writeFseq } from '../public/js/fseq.ts';
import { decodeChunk, parseManifest, readFrame } from '../public/js/frames-stream.ts';
import { createServer } from '../src/app.ts';
import { parseFseq } from '../src/frames.ts';
import { IMMUTABLE } from '../src/frames-http.ts';
import { lineRig } from './fixtures/rigs.js';
import { HAS_ZSTD, inflateBlock } from '../src/fseq-codec.ts';

const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
const PIXEL = 'function pixel(p, t, P) { return [p.x, p.y, p.z]; }';
const FRAMES = 170; // three chunks, the last one short
const C = 6;

/** What the stand-in box bakes for `// seed n` code: a fade, a chase and constants, so chunks differ. */
function bakedData(seed) {
  const data = new Uint8Array(FRAMES * C);
  for (let f = 0; f < FRAMES; f++) {
    data.set([f & 255, (f * seed) & 255, 9, f % 40 < 3 ? 255 : 0, seed, (f >> 2) & 255], f * C);
  }
  return data;
}
const code = (seed) => `// seed ${seed}\n${PIXEL}`;

let tmp, app, alice, bob, carol, anon;

async function startApp() {
  const publicDir = path.join(tmp, 'public');
  await mkdir(path.join(publicDir, 'data'), { recursive: true });
  await writeFile(path.join(publicDir, 'index.html'), '<!doctype html><title>t</title>');
  await writeFile(path.join(publicDir, 'data', 'rig.json'), JSON.stringify(lineRig(2)));
  const renderBox = {
    config: { seconds: 5 },
    probe: async () => ({ ok: true }),
    async render({ layers }) {
      const data = bakedData(Number(/seed (\d+)/.exec(layers[0].code)?.[1] ?? 1));
      return { bytes: Buffer.from(writeFseq({ frames: FRAMES, data, ranges: [[0, C]], uniqueId: 1 })) };
    },
  };
  const generator = { enqueue() {}, async idle() {} };
  const dataDir = path.join(tmp, 'data');
  app = await createServer({ dataDir, publicDir, generator, log: quiet, renderBox, curators: ['carol'] });
  const addr = await app.listen(0, '127.0.0.1');
  app.base = `http://127.0.0.1:${addr.port}`;
}

/** A GET with exactly these headers, the body as raw bytes (nothing decoded). */
function get(user, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const cookie = user.cookie ? { cookie: user.cookie } : {};
    const req = http.request(app.base + p, { headers: { ...cookie, ...headers } }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function send(user, method, p, body) {
  const res = await fetch(app.base + p, {
    method, headers: { 'content-type': 'application/json', ...(user.cookie ? { cookie: user.cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const cookie = /^(studio_session=[^;]+)/.exec(res.headers.getSetCookie().join('\n'))?.[1];
  if (cookie) user.cookie = cookie;
  return { status: res.status, json: await res.json() };
}

async function signup(name) {
  const user = { cookie: '' };
  const res = await send(user, 'POST', '/api/signup', { username: name, password: 'correct horse battery' });
  assert.equal(res.status, 201);
  return user;
}

/** A baked look of alice's (frames from `seed`), encoded for the wire: the look, its hash, its URLs. */
async function bakedLook(seed, extra = {}) {
  const body = { title: 'Wire', layers: [{ code: code(seed) }], ...extra };
  const look = (await send(alice, 'POST', '/api/looks', body)).json.look;
  assert.equal((await send(alice, 'POST', `/api/looks/${look.id}/bake`)).status, 202);
  await app.bakes.idle();
  await app.frames.idle();
  const wire = await get(alice, `/api/looks/${look.id}/frames/wire`);
  assert.equal(wire.status, 302);
  const hash = /\/frames\/([0-9a-f]{32})\/manifest$/.exec(wire.headers.location)[1];
  return { look, hash, base: `/api/looks/${look.id}/frames/${hash}/` };
}

beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'folly-wire-'));
  await startApp();
  [alice, bob, carol] = [await signup('alice'), await signup('bob'), await signup('carol')];
  anon = { cookie: '' };
});
afterAll(async () => {
  await app?.close();
  await rm(tmp, { recursive: true, force: true });
});

describe('streaming frames', () => {
  test('immutable manifest and chunks; br, else gzip (made once), else plain; all exact', async () => {
    const { look, hash, base } = await bakedLook(3);
    const wire = await get(alice, `/api/looks/${look.id}/frames/wire`);
    assert.equal(wire.headers['cache-control'], 'no-store', 'the pointer is never cached');
    const man = await get(alice, `${base}manifest`);
    assert.equal(man.status, 200);
    assert.equal(man.headers['cache-control'], IMMUTABLE);
    assert.equal(IMMUTABLE, 'public, max-age=31536000, immutable');
    assert.match(man.headers['content-type'], /^application\/json/);
    const manifest = parseManifest(JSON.parse(man.body));
    assert.equal(manifest.hash, hash);
    assert.equal(manifest.frames, FRAMES);
    assert.deepEqual(manifest.ranges, [[0, C]]);
    assert.equal((await get(alice, `${base}manifest`, { 'if-none-match': man.headers.etag })).status, 304);

    const data = bakedData(3);
    const frame = new Uint8Array(C);
    for (let n = 0; n < 3; n++) {
      const br = await get(alice, `${base}${n}`, { 'accept-encoding': 'gzip, deflate, br' });
      assert.equal(br.status, 200);
      assert.equal(br.headers['content-encoding'], 'br');
      assert.equal(br.headers['cache-control'], IMMUTABLE);
      assert.equal(br.headers.vary, 'Accept-Encoding');
      assert.equal(Number(br.headers['content-length']), manifest.chunks[n].bytes);
      const raw = zlib.brotliDecompressSync(br.body);
      const gz = await get(alice, `${base}${n}`, { 'accept-encoding': 'br;q=0, gzip' });
      assert.equal(gz.headers['content-encoding'], 'gzip');
      assert.equal(gz.headers['cache-control'], IMMUTABLE);
      assert.notEqual(gz.headers.etag, br.headers.etag, 'a variant of its own');
      assert.ok(existsSync(path.join(tmp, 'data', 'frames', hash, `${n}.gz`)), 'the gzip copy is kept');
      assert.deepEqual((await get(alice, `${base}${n}`, { 'accept-encoding': 'gzip' })).body, gz.body);
      const plain = await get(alice, `${base}${n}`, { 'accept-encoding': 'identity' });
      assert.equal(plain.headers['content-encoding'], undefined);
      assert.deepEqual(plain.body, raw);
      for (const body of [raw, zlib.gunzipSync(gz.body)]) {
        const chunk = decodeChunk(new Uint8Array(body), manifest, n);
        for (let j = 0; j < chunk.frames; j++) {
          const f = n * manifest.chunkFrames + j;
          assert.deepEqual(readFrame(chunk, j, frame), data.subarray(f * C, (f + 1) * C), `frame ${f}`);
        }
      }
      assert.equal((await get(alice, `${base}${n}`, { 'if-none-match': br.headers.etag })).status, 304);
    }
    assert.equal((await get(alice, `${base}3`)).status, 404, 'past the last chunk');
    assert.equal((await get(alice, `/api/looks/${look.id}/frames/${'0'.repeat(32)}/0`)).status, 404, 'not its hash');
  });

  test('only the owner, or anyone signed in once it is shared (curators too)', async () => {
    const { look, base } = await bakedLook(4);
    const urls = [`/api/looks/${look.id}/frames/wire`, `${base}manifest`, `${base}0`, `/api/looks/${look.id}/frames`];
    for (const u of urls) {
      assert.ok([200, 302].includes((await get(alice, u)).status), u);
      assert.equal((await get(bob, u)).status, 404, `${u}: private`);
      assert.equal((await get(carol, u)).status, 404, `${u}: curators see shared looks only`);
      assert.equal((await get(anon, u)).status, 401, u);
    }
    assert.equal((await send(alice, 'PUT', `/api/looks/${look.id}`, { shared: true })).status, 200);
    for (const u of urls) {
      for (const who of [bob, carol]) assert.ok([200, 302].includes((await get(who, u)).status), u);
      assert.equal((await get(anon, u)).status, 401, u);
    }
  });

  test('while the chunks are being made the wire says 202, then redirects', async () => {
    const { look, hash } = await bakedLook(5);
    await rm(path.join(tmp, 'data', 'frames', hash), { recursive: true });
    const wait = await get(alice, `/api/looks/${look.id}/frames/wire`);
    assert.equal(wait.status, 202);
    assert.equal(wait.headers['retry-after'], '2');
    assert.equal(JSON.parse(wait.body).pending, true);
    await app.frames.idle();
    assert.equal((await get(alice, `/api/looks/${look.id}/frames/wire`)).status, 302);
    const none = (await send(alice, 'POST', '/api/looks', { title: 'Unbaked', layers: [{ code: code(5) }] })).json.look;
    assert.equal((await get(alice, `/api/looks/${none.id}/frames/wire`)).status, 404);
  });

  test('looks with the same frames share a folder; it goes when no bake names it', async () => {
    const one = await bakedLook(6);
    const two = await bakedLook(6);
    assert.equal(one.hash, two.hash);
    const folder = path.join(tmp, 'data', 'frames', one.hash);
    assert.equal((await send(alice, 'DELETE', `/api/looks/${one.look.id}`)).status, 200);
    assert.ok(existsSync(path.join(folder, 'manifest.json')), 'still used by the other look');
    assert.equal((await get(alice, `${two.base}0`)).status, 200);
    assert.equal((await send(alice, 'PUT', `/api/looks/${two.look.id}`, { layers: [{ code: code(7) }] })).status, 200);
    assert.ok(!existsSync(folder), 'new code dropped the bake, and its chunks');
    assert.equal((await get(alice, `${two.base}0`)).status, 404);
  });
});

describe('.fseq downloads', () => {
  test('plain as before, or compressed FSEQ v2 with ?compress', async () => {
    const { look, hash } = await bakedLook(8, { title: 'Down load!' });
    const url = `/api/looks/${look.id}/frames`;
    const plain = await get(alice, url, { 'accept-encoding': 'identity' });
    assert.equal(plain.status, 200);
    const data = Uint8Array.from(parseFseq(plain.body).data);
    assert.deepEqual(data, bakedData(8));
    for (const [ask, type] of [['1', HAS_ZSTD ? 1 : 2], ['zlib', 2], ...(HAS_ZSTD ? [['zstd', 1]] : [])]) {
      const res = await get(alice, `${url}?compress=${ask}`, { 'accept-encoding': 'gzip' });
      assert.equal(res.status, 200, ask);
      assert.equal(res.headers['content-encoding'], undefined, 'already compressed');
      assert.equal(res.headers['content-disposition'], 'attachment; filename="Down-load.fseq"');
      assert.equal(res.body[20] & 0x0f, type, `compress=${ask}`);
      assert.deepEqual(parseFseq(res.body, { decompress: inflateBlock }).data, data);
      assert.notEqual(res.headers.etag, plain.headers.etag);
      assert.equal((await get(alice, `${url}?compress=${ask}`, { 'if-none-match': res.headers.etag })).status, 304);
    }
    assert.equal((await get(alice, `${url}?compress=lz4`)).status, 400);
    assert.equal((await get(bob, `${url}?compress=1`)).status, 404);
    assert.ok(existsSync(path.join(tmp, 'data', 'frames', hash, 'frames.zlib.fseq')), 'made once, then kept');
    // Frames gone (evicted for the disk cap): baked again on demand, the same bytes, the same bake.
    await unlink(path.join(tmp, 'data', 'frames', `${look.id}.fseq`));
    const gone = await get(alice, `${url}?compress=zlib`);
    assert.equal(gone.status, 503);
    assert.equal(gone.headers['retry-after'], '30');
    await app.bakes.idle();
    const again = await get(alice, url, { 'accept-encoding': 'identity' });
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, plain.body);
    assert.equal(again.headers.etag, plain.headers.etag, 'the bake record is kept');
  });
});
