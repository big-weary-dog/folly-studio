#!/usr/bin/env node
// npm run perf: the Studio's live preview on a mid-range phone. A real server on a temporary data folder, headless
// Chromium (Playwright from `npm root -g`, browsers in /opt/pw-browsers) at 390 × 844, and the demo composed look
// (a warp, two sources, a mask and globals). At each CPU slowdown, in the Points view and in the Playa view at its
// phone tier (lite), it counts the frames the sandbox answers and the 3D view draws, the worker's ms, and the main
// thread's long tasks; at 4× both must stay ≥ 20 fps and no long task may reach 100 ms. CDP's
// Emulation.setCPUThrottlingRate slows the page's thread, but Chrome refuses it for workers, so the sandbox's worker
// is slowed by the same factor here: each frame busy-waits (rate − 1) × its own compute time, and its reported times
// scale with it. Not in npm test.
//   PERF_RATES=1,4  PERF_SECONDS=10  PERF_VIEWS=points,playa
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createServer } from '../../src/app.js';
import { quiet } from '../fixtures/server.js';
import { loadPlaywright } from './mirage.mjs';

const RATES = (process.env.PERF_RATES || '1,4').split(',').map(Number);
const SECONDS = Number(process.env.PERF_SECONDS) || 10;
const VIEWS = (process.env.PERF_VIEWS || 'points,playa').split(',');
const MIN_FPS = 20, MAX_TASK_MS = 100;
const log = (m) => console.log(`perf: ${m}`);
const code = (name) => readFile(new URL(`../../public/patterns/${name}.js`, import.meta.url), 'utf8');

/** The demo composed look: meteors masked by clouds through a twist, on a palette with energy and a macro. */
async function demoLook() {
  const mod = async (id, kind, ref, extra = {}) => ({ id, kind, title: ref, ref, code: await code(ref), params: {},
    ...extra });
  return {
    title: 'Perf demo', duration: 30,
    layers: [{ id: 'l1', title: 'Storm', groups: ['cathedral'], blend: 'add', level: 1, modules: [
      await mod('m1', 'warp', 'twist'), await mod('m2', 'source', 'meteors'),
      await mod('m3', 'source', 'clouds', { as: 'input' }), await mod('m4', 'filter', 'mask', { input: 'm3' })] }],
    globals: { palette: 'carnival', energy: 0.7, hue: 0.05, macros: { storm: { value: 0.4, min: 0, max: 1 } } },
    automation: { storm: [[0, 0], [30, 1]] },
  };
}

// In each frame, before its scripts. The page: count the sandbox's frame replies and the frames the 3D view draws
// (its last pass, a full-screen triangle onto the canvas), record long tasks. The sandbox: slow its worker `rate`
// times, as a phone's core would be (its source is a Blob; the probe goes first).
function probe({ rate, view }) {
  if (window !== window.top) {
    const Blob0 = Blob;
    const slow = `(() => { const now = performance.now.bind(performance), post = self.postMessage.bind(self);
      let t0 = 0;
      self.addEventListener('message', (e) => { if (e.data && e.data.type === 'frame') t0 = now(); });
      self.postMessage = (m, transfer) => {
        if (m && m.type === 'frame' && t0) {
          const end = now() + (${rate} - 1) * (now() - t0);
          while (now() < end);
          m.ms *= ${rate};
          for (const id in m.layerMs) m.layerMs[id] *= ${rate};
        }
        return post(m, transfer);
      };
    })();\n`;
    window.Blob = function (parts, opts) {
      return new Blob0(opts?.type === 'text/javascript' ? [slow, ...parts] : parts, opts);
    };
    return;
  }
  const p = window.perfProbe = { frames: 0, first: 0, last: 0, ms: [], layers: {}, tasks: [], draws: 0, d0: 0, d1: 0 };
  localStorage.setItem('studio.render', view);
  localStorage.setItem('studio.quality', 'lite');
  const GL = WebGL2RenderingContext.prototype, bind = GL.bindFramebuffer, drawArrays = GL.drawArrays;
  GL.bindFramebuffer = function (target, fb) { this.perfFb = fb; return bind.call(this, target, fb); };
  GL.drawArrays = function (mode, first, count) {
    if (mode === this.TRIANGLES && count === 3 && !this.perfFb) {
      if (!p.draws++) p.d0 = performance.now();
      p.d1 = performance.now();
    }
    return drawArrays.call(this, mode, first, count);
  };
  const seen = (e) => {
    if (e.data?.type !== 'frame' || !e.data.rgb) return;
    if (!p.frames++) p.first = performance.now();
    p.last = performance.now();
    p.ms.push(e.data.ms);
    for (const [id, ms] of Object.entries(e.data.layerMs || {})) (p.layers[id] ||= []).push(ms);
  };
  // Frames come back over the MessagePort the app hands the sandbox: watch whatever handles a port's messages.
  const on = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
  Object.defineProperty(MessagePort.prototype, 'onmessage', { ...on,
    set(fn) { on.set.call(this, fn && ((e) => { seen(e); return fn(e); })); } });
  new PerformanceObserver((list) => { for (const t of list.getEntries()) p.tasks.push(t.duration); })
    .observe({ type: 'longtask', buffered: true });
}

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : 0);

async function measure(browser, origin, cookie, lookId, rate, view) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true });
  await context.addCookies([{ name: 'studio_session', value: cookie.split('=')[1], url: origin }]);
  await context.addInitScript(probe, { rate, view });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${origin}/studio/${lookId}`);
  await page.waitForFunction(() => window.perfProbe?.frames > 10, null, { timeout: 60000 });
  // The sandbox frame shares the page's process and thread unless the browser isolates it: throttle each.
  for (const f of page.frames()) {
    const cdp = await context.newCDPSession(f).catch(() => null);  // only an out-of-process frame has its own
    await cdp?.send('Emulation.setCPUThrottlingRate', { rate });
  }
  await page.waitForTimeout(4000);         // settle: the rate adapts within a second or two
  await page.evaluate(() => Object.assign(window.perfProbe, { frames: 0, ms: [], layers: {}, tasks: [], draws: 0 }));
  await page.waitForTimeout(SECONDS * 1000);
  const p = await page.evaluate(() => window.perfProbe);
  const stats = await page.locator('.tp-stats').textContent();
  const heavy = await page.locator('.layer-heavy:not([hidden])').count();
  const mode = await page.locator('.view-modes .mode-btn[aria-pressed=true]').first().getAttribute('data-mode');
  await context.close();
  const layerMs = Object.fromEntries(Object.entries(p.layers).map(([id, v]) => [id, median(v)]));
  return { rate, view, mode, fps: ((p.frames - 1) * 1000) / (p.last - p.first), ms: median(p.ms), layerMs,
    draws: ((p.draws - 1) * 1000) / (p.d1 - p.d0),
    longest: Math.max(0, ...p.tasks), tasks: p.tasks.length, stats, heavy, errors };
}

async function main() {
  const { chromium } = loadPlaywright();
  const tmp = await mkdtemp(path.join(tmpdir(), 'studio-perf-'));
  const renderBox = { probe: async () => ({ ok: false, reason: 'off' }), render: async () => ({}) };
  const app = await createServer({ dataDir: tmp, log: quiet, generator: { enqueue() {} }, renderBox });
  const { port } = await app.listen(0);
  const origin = `http://127.0.0.1:${port}`;
  let browser;
  try {
    const post = (url, body, cookie = '') => fetch(origin + url, { method: 'POST', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', cookie } });
    const signup = await post('/api/signup', { username: 'perf', password: 'perf-password' });
    const cookie = signup.headers.getSetCookie()[0].split(';')[0];
    const made = await post('/api/looks', await demoLook(), cookie);
    if (!made.ok) throw new Error(`perf: the demo look was refused: ${await made.text()}`);
    const { look } = await made.json();
    browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const results = [];
    for (const view of VIEWS) {
      for (const rate of RATES) {
        const r = await measure(browser, origin, cookie, look.id, rate, view);
        results.push(r);
        const layers = Object.values(r.layerMs).map((v) => v.toFixed(1)).join(', ');
        log(`${view} (shown: ${r.mode}), ${rate}× CPU: ${r.fps.toFixed(1)} fps computed, ${r.draws.toFixed(1)} drawn, `
          + `worker ${r.ms.toFixed(1)} ms a frame (layers ${layers} ms), longest task ${r.longest.toFixed(0)} ms `
          + `(${r.tasks} over 50 ms), heavy badges ${r.heavy}; the transport says "${r.stats}"`);
        for (const e of r.errors) log(`page error: ${e}`);
      }
    }
    const fails = [];
    for (const phone of results.filter((r) => r.rate === Math.max(...RATES))) {
      const at = `${phone.view} at ${phone.rate}×`;
      if (phone.mode !== phone.view) fails.push(`${phone.view} asked for, ${phone.mode} shown`);
      if (phone.fps < MIN_FPS) fails.push(`${phone.fps.toFixed(1)} fps computed (${at}), under ${MIN_FPS}`);
      if (!(phone.draws >= MIN_FPS)) fails.push(`${phone.draws.toFixed(1)} fps drawn (${at}), under ${MIN_FPS}`);
      if (phone.longest >= MAX_TASK_MS) fails.push(`a ${phone.longest.toFixed(0)} ms task (${at})`);
    }
    if (results.some((r) => r.errors.length)) fails.push('page errors');
    if (fails.length) {
      log(`FAIL: ${fails.join('; ')}`);
      process.exitCode = 1;
    } else log('ok');
  } finally {
    await browser?.close();
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  }
}

await main();
