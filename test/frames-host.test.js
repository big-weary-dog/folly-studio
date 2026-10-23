// Baked frames on a home machine: low priority (the encoder thread and the render box at nice 10), one heavy
// job at a time, brotli quality, the content-hash bake cache, the disk cap and re-baking what it evicted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';

import { writeFseq } from '../public/js/fseq.ts';
import { createServer } from '../src/app.ts';
import { createLane } from '../src/bake.ts';
import { createFrameJobs, createFramesCache, createFramesDisk } from '../src/frames-cache.ts';
import { wireHash } from '../src/frames-wire.ts';
import { createRenderBox } from '../src/render-box.ts';
import { lineRig } from './fixtures/rigs.js';

const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
const PIXEL = 'function pixel(p, t) { return [p.x, p.y, p.z]; }';
let tmp;
beforeAll(async () => { tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-frames-host-')); });
afterAll(() => rm(tmp, { recursive: true, force: true }));

/** A thread's nice value, from /proc (Linux keeps nice per thread). */
const niceOf = (tid) => Number(fs.readFileSync(`/proc/self/task/${tid}/stat`, 'utf8').split(') ')[1].split(' ')[16]);
/** Nice values of this process's threads, skipping any just exited; listed as strings, not in tid order. */
const threadNice = () => fs.readdirSync('/proc/self/task').flatMap((tid) => {
  try { return [niceOf(tid)]; } catch { return []; }
});

/** Frames that change over time (so they compress differently by quality), `frames` long. */
function frames(seed, count = 170, channels = 300) {
  const data = new Uint8Array(count * channels);
  for (let f = 0; f < count; f++) {
    for (let c = 0; c < channels; c++) data[f * channels + c] = (f * seed + c * (c % 7) + ((f * c) >> 3)) & 255;
  }
  return Buffer.from(writeFseq({ frames: count, data, ranges: [[0, channels]], uniqueId: 1 }));
}

describe('low priority, one at a time', () => {
  test('a lane runs its tasks one at a time, in order', async () => {
    const lane = createLane();
    let active = 0, peak = 0;
    const order = [];
    const task = (n) => async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      order.push(n);
      active--;
      if (n === 1) throw new Error('a failure does not stop the lane');
    };
    const runs = [0, 1, 2].map((n) => lane.run(task(n)));
    assert.equal(lane.size, 3);
    await Promise.allSettled(runs);
    assert.deepEqual(order, [0, 1, 2]);
    assert.equal(peak, 1);
    assert.equal(lane.size, 0);
  });

  test('the encoder runs in a worker thread at nice 10, stopped when idle', async () => {
    const jobs = createFrameJobs({ log: quiet, idleMs: 60_000 });
    const file = path.join(tmp, 'f.fseq');
    const bytes = frames(3);
    fs.writeFileSync(file, bytes);
    const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    const seen = [];
    const out = path.join(tmp, 'wire');
    const r = await jobs.run('wire', { file, sha256, dir: out, hash: 'ab'.repeat(16), quality: 5,
      maxBytes: bytes.length }, (p) => seen.push(p.done));
    assert.equal(r.frames, 170);
    assert.deepEqual(seen, [0, 1, 2, 3]);
    assert.ok(fs.existsSync(path.join(out, 'manifest.json')));
    assert.ok(threadNice().includes(10), 'a thread at nice 10');
    assert.equal(niceOf(process.pid), 0, 'the event loop keeps its priority');
    await assert.rejects(jobs.run('wire', { file, sha256: '0'.repeat(64), dir: out, hash: 'cd'.repeat(16),
      quality: 5, maxBytes: bytes.length }), /changed/);
    await jobs.close();
    // close() resolves once the thread is joined, but the kernel lets a join return (it clears the thread's id
    // early in exit) before the thread leaves /proc/self/task; at nice 10 on a busy machine that can take a while.
    for (let i = 0; i < 100 && threadNice().includes(10); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(!threadNice().includes(10), 'the encoder thread is gone');
  });

  test('brotli quality is the cache\'s to choose (STUDIO_FRAMES_BROTLI_QUALITY)', async () => {
    const sizes = {};
    for (const quality of [1, 9]) {
      const framesDir = path.join(tmp, `q${quality}`);
      fs.mkdirSync(framesDir);
      const bytes = frames(5);
      const look = { id: 'look1', bake: { source: 'render-box', status: 'done', frames: { bytes: bytes.length,
        sha256: (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex') } } };
      fs.writeFileSync(path.join(framesDir, 'look1.fseq'), bytes);
      const store = { looks: { get: () => look, list: (fn = () => true) => [look].filter(fn) } };
      const cache = createFramesCache({ framesDir, store, log: quiet, quality });
      assert.equal(await cache.encode(look), true);
      const hash = wireHash(look.bake.frames.sha256);
      sizes[quality] = JSON.parse(fs.readFileSync(path.join(framesDir, hash, 'manifest.json'))).bytes;
      await cache.close();
    }
    assert.ok(sizes[9] < sizes[1], `q9 ${sizes[9]} < q1 ${sizes[1]}`);
  });
});

describe('the disk cap', () => {
  test('evicts the least recently used bakes, never a reviewed or a fleet-box one', async () => {
    const framesDir = path.join(tmp, 'cap');
    fs.mkdirSync(framesDir);
    const looks = [];
    const add = (id, sha, bake = {}, extra = {}) => {
      looks.push({ id, reviewed: false, ...extra, bake: { source: 'render-box', status: 'done',
        frames: { sha256: sha }, ...bake } });
      fs.writeFileSync(path.join(framesDir, `${id}.fseq`), Buffer.alloc(1000));
      fs.mkdirSync(path.join(framesDir, wireHash(sha)), { recursive: true });
      fs.writeFileSync(path.join(framesDir, wireHash(sha), '0.br'), Buffer.alloc(100));
    };
    const age = (id, s) => {
      const t = new Date(Date.now() - s * 1000);
      fs.utimesSync(path.join(framesDir, `${id}.fseq`), t, t);
    };
    add('old', 'a'.repeat(64));
    add('reviewed', 'b'.repeat(64), {}, { reviewed: true });
    add('fleet', 'c'.repeat(64), { source: 'fleet-box' });
    add('mid', 'd'.repeat(64));
    add('new', 'e'.repeat(64));
    fs.linkSync(path.join(framesDir, 'new.fseq'), path.join(framesDir, 'twin.fseq'));
    looks.push({ id: 'twin', bake: { source: 'render-box', status: 'done', frames: { sha256: 'e'.repeat(64) } } });
    [['old', 500], ['reviewed', 900], ['fleet', 800], ['mid', 300], ['new', 10]].forEach(([id, s]) => age(id, s));
    const store = { looks: { list: (fn = () => true) => looks.filter(fn) } };
    const disk = createFramesDisk({ framesDir, store, maxBytes: 3500, log: quiet });
    const { total } = await disk.usage();
    assert.equal(total, 5 * 1100, 'a hard link counts once');
    disk.touch(looks.find((l) => l.id === 'old')); // used just now: newest
    await disk.evict();
    const left = fs.readdirSync(framesDir).filter((n) => n.endsWith('.fseq')).sort();
    assert.deepEqual(left, ['fleet.fseq', 'old.fseq', 'reviewed.fseq']);
    assert.ok(!fs.existsSync(path.join(framesDir, wireHash('d'.repeat(64)))), 'its wire folder went with it');
    assert.ok((await disk.usage()).total <= 3500);
  });
});

describe('the bake cache and re-baking evicted frames, through the API', () => {
  let app, base, cookie, renders = 0;
  beforeAll(async () => {
    const publicDir = path.join(tmp, 'public');
    fs.mkdirSync(path.join(publicDir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>t</title>');
    fs.writeFileSync(path.join(publicDir, 'data', 'rig.json'), JSON.stringify(lineRig(100)));
    const renderBox = { config: { seconds: 5 }, probe: async () => ({ ok: true }),
      async render({ layers }) { renders++; return { bytes: frames(layers[0].code.length, 200) }; } };
    app = await createServer({ dataDir: path.join(tmp, 'data'), publicDir, generator: { enqueue() {} }, log: quiet,
      customCode: true, renderBox });
    base = `http://127.0.0.1:${(await app.listen(0)).port}`;
    const r = await fetch(`${base}/api/signup`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'cache', password: 'correct horse' }) });
    cookie = r.headers.getSetCookie()[0].split(';')[0];
  });
  afterAll(() => app.close());
  const call = (method, p, body) => fetch(base + p, { method, redirect: 'manual', headers: { cookie,
    'content-type': 'application/json' }, body: body && JSON.stringify(body) });

  test('a look that renders what another baked takes its frames without baking', async () => {
    const make = async (title) => (await (await call('POST', '/api/looks', { title, layers: [{ code: PIXEL }] }))
      .json()).look;
    const first = await make('First');
    assert.equal((await call('POST', `/api/looks/${first.id}/bake`, {})).status, 202);
    await app.bakes.idle();
    await app.frames.idle();
    assert.equal(renders, 1);
    const second = await make('Second, same code');
    const r = await (await call('POST', `/api/looks/${second.id}/bake`, {})).json();
    assert.equal(r.bake.status, 'done', 'at once');
    assert.equal(renders, 1, 'no second render');
    const a = (await (await call('GET', `/api/looks/${first.id}`)).json()).look.bake;
    const b = (await (await call('GET', `/api/looks/${second.id}`)).json()).look.bake;
    assert.equal(b.frames.sha256, a.frames.sha256);
    assert.equal(b.renderKey, a.renderKey);
    const dir = path.join(tmp, 'data', 'frames');
    assert.equal(fs.statSync(path.join(dir, `${second.id}.fseq`)).ino, fs.statSync(path.join(dir, `${first.id}.fseq`))
      .ino, 'one file on disk');
    assert.equal((await call('POST', `/api/looks/${first.id}/bake`, {})).status, 202);
    assert.equal(renders, 1, 'baking an unchanged look again is free');
  });

  test('evicted frames are baked again when asked for, keeping the bake (and its review)', async () => {
    const { look } = await (await call('POST', '/api/looks', { title: 'Evict me', layers: [{ code: `${PIXEL} ` }] }))
      .json();
    await call('POST', `/api/looks/${look.id}/bake`, {});
    await app.bakes.idle();
    await app.frames.idle();
    const baked = app.store.looks.get(look.id);
    const before = renders;
    const dir = path.join(tmp, 'data', 'frames');
    fs.rmSync(path.join(dir, `${look.id}.fseq`));
    fs.rmSync(path.join(dir, wireHash(baked.bake.frames.sha256)), { recursive: true });
    const pending = await call('GET', `/api/looks/${look.id}/frames/wire`);
    assert.equal(pending.status, 202);
    await app.bakes.idle();
    await app.frames.idle();
    assert.equal(renders, before + 1);
    assert.equal((await call('GET', `/api/looks/${look.id}/frames/wire`)).status, 302);
    const now = app.store.looks.get(look.id);
    assert.deepEqual({ ...now.bake, checkedAt: null }, { ...baked.bake, checkedAt: null });
    assert.ok(now.bake.checkedAt >= baked.bake.checkedAt, 'the restored bytes were checked again');
  });
});

const probe = await createRenderBox({ log: quiet }).probe();
/** /proc/<pid>/stat's fields from the state on: [1] parent, [16] nice. */
const stat = (pid) => fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
describe('the render box runs at nice 10', () => {
  beforeEach(({ skip }) => skip(!probe.ok || !!probe.libraryOnly,
    `render box unavailable here: ${probe.reason || probe.libraryOnly}`));
  test('its processes have nice 10', async () => {
    const box = createRenderBox({ seconds: 3, frameTimeoutMs: 600_000, log: quiet });
    const slow = { id: 'l1', groups: ['cathedral'], blend: 'add', level: 1, params: {},
      code: 'function pixel(p, t) { let s = 0; for (let i = 0; i < 300; i++) s += sin(i); return [s, 0, 0]; }' };
    const done = box.render({ layers: [slow] });
    let nice = null;
    for (let i = 0; i < 200 && nice === null; i++) {
      await new Promise((r) => setTimeout(r, 25));
      for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
        try {
          // The box's node itself: the nice wrapper carries the same arguments but is at 0 until it has run.
          if (!fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').startsWith('/box/node\0')) continue;
          // Ours: other test files and runs have boxes of their own.
          let up = Number(stat(pid)[1]);
          while (up > 1 && up !== process.pid) up = Number(stat(up)[1]);
          if (up === process.pid) nice = Number(stat(pid)[16]);
        } catch {}
      }
    }
    await done.catch(() => {});
    assert.equal(nice, 10);
  });
});
