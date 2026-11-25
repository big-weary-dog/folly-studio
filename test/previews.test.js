// Gallery previews (SPEC-previews): the window that moves the most, the loop, and the queue and route that
// make and serve them for shared looks.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, test } from 'vitest';

import { writeFseq } from '../public/js/fseq.ts';
import { bestWindow, HEIGHT, previewFrames, WIDTH, WINDOW_S } from '../src/previews/motion.ts';
import { playaCamera } from '../src/previews/playa.ts';
import { GLOW, writeLibrary } from './fixtures/library.js';
import { lineRig } from './fixtures/rigs.js';
import { quiet } from './fixtures/quiet.js';
import { serve, signup } from './fixtures/app.js';
import { stubBox } from './fixtures/box.js';

const N = 4, C = N * 3, SECONDS = 20, FRAMES = SECONDS * 40;
// Dim and still, but for a bright flicker from 8 s to 14 s.
function frames(busyFrom = 8, busyTo = 14) {
  const data = new Uint8Array(FRAMES * C);
  for (let f = 0; f < FRAMES; f++) {
    const s = f / 40, busy = s >= busyFrom && s < busyTo;
    // Busy: LEDs swap between bright and dim, so every frame is as bright and each one changes.
    for (let c = 0; c < C; c++) data[f * C + c] = !busy ? 20 : ((Math.floor(c / 3) + (f >> 2)) % 2 ? 250 : 40);
  }
  return Buffer.from(writeFseq({ frames: FRAMES, data, ranges: [[0, C]], uniqueId: 1 }));
}

describe('the preview window', () => {
  test('picks the stretch that changes most, brightness breaking ties', () => {
    const change = Float64Array.from([0, 0, 0, 0.5, 0.5, 0.5, 0, 0]), bright = new Float64Array(8).fill(0.1);
    assert.equal(bestWindow(change, bright, 3), 2, 'the jump into the busy stretch counts');
    const still = new Float64Array(8), lit = Float64Array.from([0, 0, 0, 0, 0, 0.9, 0.9, 0.9]);
    assert.equal(bestWindow(still, lit, 3), 5);
    assert.equal(bestWindow(still, lit, 20), 0, 'a look shorter than the window shows all of it');
  });

  test('frames: the busy stretch, looped by a fade or a crossfade', async () => {
    const rig = lineRig(N);
    const fade = await previewFrames(frames(), rig, { loop: 'fade' });
    assert.ok(fade.start >= 7.5 && fade.start + fade.seconds <= 14.5, `window at ${fade.start} s`);
    assert.ok(Math.abs(fade.seconds - WINDOW_S) < 0.2);
    assert.equal(fade.frames[0].length, fade.width * fade.height * 3);
    const peak = (img) => img.reduce((a, v) => Math.max(a, v), 0);
    const mean = (img) => img.reduce((a, v) => a + v, 0) / img.length;
    const middle = mean(fade.frames[Math.floor(fade.frames.length / 2)]);
    assert.ok(mean(fade.frames[0]) < middle / 4, 'fades in');
    assert.ok(mean(fade.frames.at(-1)) < middle / 4, 'fades out');
    assert.equal(peak(fade.still), 250, 'the still is the brightest sample, unfaded');
    const cross = await previewFrames(frames(), rig, { loop: 'crossfade' });
    assert.equal(cross.frames.length, fade.frames.length);
    assert.ok(cross.frames.every((img) => mean(img) > middle / 2), 'never dark');
  });
});

test('the Playa camera draws the installation lit as the samples say', async (ctx) => {
  const { camera, close } = playaCamera({ log: quiet });
  try {
    const rig = JSON.parse(await readFile(new URL('../public/data/rig.json', import.meta.url), 'utf8'));
    const dark = new Uint8Array(rig.count * 3), lit = new Uint8Array(rig.count * 3).fill(255);
    let shot;
    try {
      shot = await camera(rig, [dark, lit]);
    } catch (err) {
      ctx.skip(/Executable doesn't exist|browserType.launch/.test(err.message), `no headless Chromium: ${err.message}`);
      throw err;
    }
    assert.deepEqual([shot.width, shot.height, shot.pictures.length], [WIDTH, HEIGHT, 2]);
    assert.equal(shot.pictures[0].length, WIDTH * HEIGHT * 3);
    const sum = (img) => img.reduce((a, v) => a + v, 0);
    assert.ok(sum(shot.pictures[1]) > 2 * sum(shot.pictures[0]), 'lit LEDs light the picture');
    const again = await camera(lineRig(N), [new Uint8Array(N * 3).fill(255)]);   // another rig: a new canvas
    assert.ok(sum(again.pictures[0]) > 0, 'draws after a change of rig');
  } finally {
    await close();
  }
});

describe('previews of shared looks', () => {
  let tmp, app, dataDir, cookie, other, start, release, holding;
  const held = new Promise((r) => { release = r; }), rendering = new Promise((r) => { holding = r; });
  const glow = (params = {}) => [{ name: 'a', code: GLOW, params }];
  const req = (p, { method = 'GET', body, as = cookie } = {}) => fetch(app.base + p, { method, headers: {
    cookie: as, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
  const until = async (fn) => {
    for (let i = 0; i < 200; i++) {
      const v = await fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('timed out');
  };
  const gallery = async () => (await (await req('/api/looks?scope=gallery')).json()).looks;
  const account = async (username) => (await signup(app, username, 'correct horse battery')).cookie;

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'previews-'));
    const publicDir = path.join(tmp, 'public');
    dataDir = path.join(tmp, 'data');
    await mkdir(path.join(publicDir, 'data'), { recursive: true });
    await writeFile(path.join(publicDir, 'index.html'), '<!doctype html><title>t</title>');
    await writeFile(path.join(publicDir, 'data', 'rig-folly.json'), JSON.stringify(lineRig(N)));
    await writeFile(path.join(publicDir, 'data', 'rig.json'), JSON.stringify({ ...lineRig(N), name: 'Other' }));
    await writeLibrary(publicDir);
    start = async (rig) => {
      const renderBox = stubBox(async ({ layers }) => {
        const { hold, late } = layers[0]?.params ?? {};
        if (hold) { holding(); await held; }
        return { bytes: late ? frames(2, 9) : frames() };
      }, SECONDS);
      app = await serve({ dataDir, publicDir, renderBox, rig,
        curators: 'alice, bob' });   // curators see every shared look, approved or not
    };
    await start();
    cookie = await account('alice');
    other = await account('bob');
  });
  afterAll(async () => {
    await app?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  test('a shared look gets a looping WebP and a still; a change makes a new one', async () => {
    const layers = glow();
    const { look } = await (await req('/api/looks', { method: 'POST',
      body: { title: 'Shared', layers, shared: true, chain: 2 } })).json();
    await req('/api/looks', { method: 'POST', body: { title: 'Mine', layers, chain: 2 } });
    const key = await until(async () => (await gallery()).find((l) => l.id === look.id)?.preview);
    const res = await req(`/api/looks/${look.id}/preview/${key}.webp`, { as: other });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/webp');
    assert.match(res.headers.get('cache-control'), /private.*immutable/);
    const meta = await sharp(Buffer.from(await res.arrayBuffer()), { animated: true }).metadata();
    assert.ok(meta.pages > 50, `${meta.pages} pages`);
    assert.equal(meta.loop, 0);
    assert.equal((await req(`/api/looks/${look.id}/preview/${key}-still.webp`)).status, 200);
    assert.equal((await req(`/api/looks/${look.id}/preview/${'0'.repeat(16)}.webp`)).status, 404);
    assert.equal((await req(`/api/looks/${look.id}/preview/..%2Fx.webp`)).status, 404);

    await req(`/api/looks/${look.id}`, { method: 'PUT', body: { layers: glow({ late: 1 }),
      chain: 2 } });
    const next = await until(async () => {
      const k = (await gallery()).find((l) => l.id === look.id)?.preview;
      return k !== key && k;
    });
    await app.previews.idle(); // the old files go once the new key is out
    assert.equal((await req(`/api/looks/${look.id}/preview/${key}.webp`)).status, 404, 'the old one is gone');
    const names = await readdir(path.join(dataDir, 'previews'));
    assert.deepEqual(names.sort(), [`${look.id}-${next}-still.webp`, `${look.id}-${next}.webp`].sort());
  });

  test('an unshared look has none, and is not served', async () => {
    const { look } = await (await req('/api/looks', { method: 'POST',
      body: { title: 'Private', layers: glow(), chain: 2 } })).json();
    await app.previews?.idle();
    assert.equal(existsSync(path.join(dataDir, 'previews', `${look.id}.webp`)), false);
    const mine = (await (await req('/api/looks?scope=mine')).json()).looks.find((l) => l.id === look.id);
    assert.equal(mine.preview, undefined);
    assert.equal((await req(`/api/looks/${look.id}/preview/x.webp`, { as: other })).status, 404);
  });

  test('a deleted account\'s previews go at once', async () => {
    const cy = await account('cyril');
    const { look } = await (await req('/api/looks', { method: 'POST', as: cy,
      body: { title: 'Doomed', layers: glow(), shared: true, chain: 2 } })).json();
    await until(async () => (await gallery()).find((l) => l.id === look.id)?.preview);
    const mine = async () => (await readdir(path.join(dataDir, 'previews'))).filter((f) => f.startsWith(look.id));
    assert.equal((await mine()).length, 2);
    assert.equal((await req('/api/me', { method: 'DELETE', as: cy, body: { password: 'correct horse battery' } }))
      .status, 200);
    assert.deepEqual(await mine(), []);
  });

  test('a preview being made when its account is deleted is not kept', async () => {
    const dot = await account('dorothy');
    await (await req('/api/looks', { method: 'POST', as: dot,
      body: { title: 'Held', layers: glow({ hold: 1 }), shared: true, chain: 2 } })).json();
    await rendering;   // its preview is being made, waiting on the render box
    assert.equal((await req('/api/me', { method: 'DELETE', as: dot, body: { password: 'correct horse battery' } }))
      .status, 200);
    release();
    await app.previews.idle();
    const ids = (await gallery()).map((l) => l.id);   // an id may hold a '-' itself
    assert.deepEqual((await readdir(path.join(dataDir, 'previews')))
      .filter((f) => !ids.some((id) => f.startsWith(`${id}-`))), []);
  });

  test('a server started on another rig makes the shared looks\' previews again', async () => {
    const { look } = await (await req('/api/looks', { method: 'POST',
      body: { title: 'Moved', layers: glow(), shared: true, chain: 2 } })).json();
    const key = await until(async () => (await gallery()).find((l) => l.id === look.id)?.preview);
    await app.close();
    await start('cog');
    await app.previews.backfill();
    const next = await until(async () => {
      const k = (await gallery()).find((l) => l.id === look.id)?.preview;
      return k !== key && k;
    });
    assert.notEqual(next, key);
  });
});
