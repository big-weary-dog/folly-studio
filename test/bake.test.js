// The render box for real: render-box/render.ts under bubblewrap, run by src/bake.ts. Where
// bubblewrap or user namespaces are missing these tests skip and say why: a skipped isolation
// test, not a passing one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';

import { createServer } from '../src/app.ts';
import { BakeError, checkFrames } from '../src/box-output.ts';
import { createRenderBox } from '../src/render-box.ts';
import { parseFseq } from '../src/frames.ts';

const STUDIO = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC = path.join(STUDIO, 'public');
const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
const rigFile = path.join(PUBLIC, 'data/rig.json');
const ready = fs.existsSync(rigFile) && fs.existsSync(path.join(PUBLIC, 'js/pattern-core.ts'));
const probe = ready ? await createRenderBox({ log: quiet }).probe() : { ok: false,
  reason: 'the pattern runtime or LED map is not built' };
const unavailable = `render box unavailable here: ${probe.reason}`;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bake-'));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
const layer = (code, extra = {}) => ({ id: 'l1', title: 'x', code, groups: ['cathedral'], blend: 'add', level: 1,
  params: {}, ...extra });
const BREATHE = 'function pixel(p, t) { return scale([0.2, 0.4, 1], wave(t * 0.25)); }';
const STROBE = 'function pixel(p, t) { return floor(t * 20) % 2 ? [0, 0, 0] : [1, 1, 1]; }';

/** /proc/<pid>/stat's fields from the state on: [0] state, [1] parent, [19] start time. */
const stat = (pid) => fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
const alive = ([pid, start]) => {
  try {
    return stat(pid)[19] === start;   // not a pid reused since
  } catch { return false; }
};

/** render.ts processes (the box's command line) this process started, as [pid, start time]: other test files run
 * boxes of their own at the same time. */
function ourBoxes() {
  const found = [];
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      if (!fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('/box/render.ts')) continue;
      let up = Number(stat(pid)[1]);
      while (up > 1 && up !== process.pid) up = Number(stat(up)[1]);
      if (up === process.pid) found.push([pid, stat(pid)[19]]);
    } catch {}
  }
  return found;
}

describe('render box (bubblewrap)', () => {
  beforeEach(({ skip }) => skip(!probe.ok, unavailable));
  let hits = 0;
  let server;
  let port;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits++;
      res.end('ok');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  afterAll(() => server.close());

  test('a normal look bakes and analyses', async () => {
    const box = createRenderBox({ seconds: 4, log: quiet });
    const { bytes, boxStats } = await box.render({ layers: [layer(BREATHE)] });
    const { bake, frames } = checkFrames(bytes, { source: 'render-box',
      rig: JSON.parse(fs.readFileSync(rigFile, 'utf8')), boxStats });
    assert.equal(bake.ok, true, bake.reason);
    assert.equal(bake.analysis.frames, 160);
    assert.equal(bake.analysis.coverage, 1);
    assert.equal(bake.analysis.sparse, true);
    assert.equal(bake.analysis.flicker.ok, true);
    assert.ok(bake.analysis.peakBrightness > 0.3);
    assert.equal(frames, bytes);
    assert.equal(boxStats.untrusted, true);
    assert.equal(boxStats.reported.ok, true);
    assert.equal(boxStats.reported.frames, 160);
  });

  test('an infinite loop is killed by the wall clock, box and all', async () => {
    const box = createRenderBox({ seconds: 2, timeoutMs: 1500, frameTimeoutMs: 600_000, log: quiet });
    const t0 = Date.now();
    const seen = new Map();
    const watch = setInterval(() => { for (const [pid, start] of ourBoxes()) seen.set(pid, start); }, 50);
    await assert.rejects(box.render({ layers: [layer('function pixel() { for (;;) {} }')] }),
      (e) => e instanceof BakeError && /longer than 2 s and was stopped/.test(e.reason))
      .finally(() => clearInterval(watch));
    assert.ok(Date.now() - t0 < 10_000);
    assert.ok(seen.size > 0, 'the box was seen running');
    let left = [...seen].filter(alive);
    for (let i = 0; i < 40 && left.length; i++) {
      await new Promise((r) => setTimeout(r, 50));
      left = left.filter(alive);
    }
    assert.deepEqual(left, [], 'nothing from the box keeps running');
    // Inside, a per-frame guard catches a hang first and names it.
    const guarded = createRenderBox({ seconds: 2, frameTimeoutMs: 300, log: quiet });
    const hang = layer('function pixel(p, t) { while (t > 0.5) {} return [1, 0, 0]; }');
    await assert.rejects(guarded.render({ layers: [hang] }),
      (e) => /took over 300 ms on the frame at t = 0\.5\d s/.test(e.reason));
  });

  test('pattern code reaches no fetch, require, process or Node realm', async () => {
    const box = createRenderBox({ seconds: 1, log: quiet });
    await assert.rejects(box.render({ layers: [layer(`fetch('http://127.0.0.1:${port}/'); ${BREATHE}`)] }),
      (e) => /does not compile: .*fetch is not a function/.test(e.reason));
    await assert.rejects(box.render({ layers: [layer(`const net = require('net'); ${BREATHE}`)] }),
      (e) => /does not compile: .*require is not defined/.test(e.reason));
    // Escapes that work against a bare node:vm with host objects in it. Green when all fail.
    const probes = `
      const tries = [
        () => Function('return process')(),
        () => clamp.constructor('return process')(),
        () => hex.constructor.constructor('return this.process')(),
        () => [].constructor.constructor('return process')(),
        () => (0, eval)('process'),
        () => Function('return globalThis')().process,
        () => Function('return typeof require === "function" ? require : undefined')(),
        () => Function('return import("node:fs")')(),
      ];
      let reached = 0;
      for (const t of tries) {
        try { const v = t(); if (v && typeof v === 'object' && !(v instanceof Promise)) reached++; } catch (e) {}
      }
      function pixel(p, t) { return reached ? [1, 0, 0] : [0, 1, 0]; }`;
    const { bytes } = await box.render({ layers: [layer(probes)] });
    const p = parseFseq(bytes);
    assert.deepEqual([...p.data.subarray(0, 3)], [0, 255, 0], 'no escape reached the host realm');
    assert.equal(hits, 0, 'nothing reached the host network');
  });

  test('the box itself: no network, no host files, nothing writable but /out', async () => {
    const secret = path.join(tmpRoot, 'secret.txt');
    fs.writeFileSync(secret, 'TOP SECRET');
    const pwned = path.join(tmpRoot, 'pwned');
    // Stand in for an escaped pattern: run arbitrary Node in the box in place of render.ts.
    const evil = path.join(tmpRoot, 'evil.mjs');
    fs.writeFileSync(evil, `
      import fs from 'node:fs';
      import net from 'node:net';
      const out = [];
      const tryIt = (name,
        fn) => { try { fn(); out.push(name + ':ok'); } catch (e) { out.push(name + ':' + (e.code || e.name)); } };
      tryIt('read-secret', () => fs.readFileSync(${JSON.stringify(secret)}));
      tryIt('read-passwd', () => fs.readFileSync('/etc/passwd'));
      tryIt('write-host', () => fs.writeFileSync(${JSON.stringify(pwned)}, 'x'));
      tryIt('write-box', () => fs.writeFileSync('/box/x', 'x'));
      tryIt('write-out', () => fs.writeFileSync('/out/scratch', 'x'));
      out.push('env:' + Object.keys(process.env).sort().join(','));
      try { await fetch('http://127.0.0.1:${port}/'); out.push('fetch:ok'); }
      catch (e) { out.push('fetch:' + (e.cause?.code || e.name)); }
      await new Promise((r) => { const s = net.connect(${port}, '127.0.0.1'); s.on('connect',
        () => { out.push('net:ok'); s.destroy(); r(); }); s.on('error', (e) => { out.push('net:' + e.code); r(); }); });
      fs.writeFileSync('/out/result.json', JSON.stringify({ ok: false, error: out.join(' ') }));
      process.exit(1);
    `);
    const box = createRenderBox({ script: evil, seconds: 1, log: quiet });
    const err = await box.render({ layers: [layer(BREATHE)] }).then(() => null, (e) => e);
    assert.ok(err instanceof BakeError, String(err));
    const said = err.reason;
    assert.match(said, /read-secret:ENOENT/);
    assert.match(said, /read-passwd:ENOENT/);
    assert.match(said, /write-host:(ENOENT|EROFS)/);
    assert.match(said, /write-box:EROFS/);
    assert.match(said, /write-out:ok/);
    assert.match(said, /env:LD_LIBRARY_PATH,(PWD,)?TMPDIR /, 'a clean environment');
    assert.match(said, /fetch:ECONNREFUSED/);
    assert.match(said, /net:ECONNREFUSED/);
    assert.equal(fs.existsSync(pwned), false);
    assert.equal(hits, 0);
  });

  test('through the API: a strobe is blocked from review, one on the spirelets only warns, a calm one passes',
    async () => {
    const app = await createServer({
      dataDir: path.join(tmpRoot, 'data'),
      publicDir: PUBLIC,
      generator: { enqueue() {}, async idle() {} },
      curators: 'cur',
      renderBox: createRenderBox({ publicDir: PUBLIC, seconds: 4, log: quiet }),
      log: quiet,
    });
    const addr = await app.listen(0);
    const base = `http://127.0.0.1:${addr.port}`;
    const login = async (username) => {
      const r = await fetch(`${base}/api/signup`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: 'correct horse' }) });
      const cookie = r.headers.getSetCookie()[0].split(';')[0];
      return (method, p, body) =>
        fetch(base + p, { method, headers: { cookie, 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body) }).then(async (res) => ({ status: res.status,
            json: await res.json().catch(() => null) }));
    };
    try {
      const own = await login('owner');
      const cur = await login('cur');
      const strobe = (await own('POST', '/api/looks', { title: 'Strobe', layers: [layer(STROBE)],
        shared: true })).json.look;
      const calm = (await own('POST', '/api/looks', { title: 'Calm', layers: [layer(BREATHE)],
        shared: true })).json.look;
      const small = (await own('POST', '/api/looks', { title: 'Spirelets', layers: [layer(BREATHE),
        layer(STROBE, { id: 'l2', groups: ['spirelets'] })], shared: true })).json.look;
      assert.equal((await own('POST', `/api/looks/${small.id}/bake`, {})).status, 202);
      assert.equal((await own('POST', `/api/looks/${strobe.id}/bake`, {})).status, 202);
      assert.equal((await cur('POST', `/api/looks/${calm.id}/bake`, {})).status, 202,
        'a curator may bake a shared look');
      await app.bakes.idle();

      const s = (await own('GET', `/api/looks/${strobe.id}`)).json.look;
      assert.equal(s.bake.source, 'render-box');
      assert.equal(s.bake.status, 'done');
      assert.equal(s.bake.analysis.flicker.ok, false);
      const blocked = await cur('PUT', `/api/looks/${strobe.id}`, { reviewed: true });
      assert.equal(blocked.status, 409);
      assert.match(blocked.json.error, /10 flashes a second/);

      assert.equal((await own('GET', `/api/looks/${calm.id}`)).json.look.bake.ok, true);
      assert.equal((await cur('PUT', `/api/looks/${calm.id}`, { reviewed: true })).json.look.reviewed, true);
      const warned = (await own('GET', `/api/looks/${small.id}`)).json.look;
      assert.equal(warned.bake.ok, true, warned.bake.reason);
      assert.match(warned.bake.warning, /small parts only \(spirelets\)/);
      assert.equal((await cur('PUT', `/api/looks/${small.id}`, { reviewed: true })).json.look.reviewed, true,
        'flashing on a small region alone does not block review');
      const frames = await fetch(`${base}/api/looks/${calm.id}/frames`, { headers: { cookie: '' } });
      assert.equal(frames.status, 401);
    } finally {
      await app.close();
    }
  });
});
