// npm run perf: the Studio's live preview on a mid-range phone. The real server on a temporary data folder and a fresh
// build, headless Chromium at 390 × 844, the demo look (a warp, two sources, a mask and globals). Each run counts the
// frames the sandbox answers and the 3D view draws, the worker's ms and the main thread's long tasks, at each CPU
// slowdown. CDP's Emulation.setCPUThrottlingRate slows the page's thread, but Chrome refuses it for workers, so the
// sandbox's worker is slowed by the same factor here: each frame's answer is held back (rate − 1) × the frame's own
// time, and its reported times scale with it. Held back, not busy-waited: a phone's slow core is its own, while a
// busy-wait here would take a CPU from everything else on a 2-CPU runner, the frame's own work included, and that
// loss would be multiplied by the rate in turn (CDP's throttle already busy-waits the page's thread).
//
// Steady state: frames flow for 2 s at full speed first (the JIT warm), then the slowdown, 6 s to settle (the app
// steps its rate at most once a second, down from 40 and up again as its average cost settles), then a fixed window
// of 11 s counted second by second. A run's fps is its median second's (the 6th of 11, so most seconds reach it):
// a stalled second or two on a noisy runner do not decide it, a slow pipeline does.
//
// What it asserts, and what it only reports:
// - compute (asserted): the sandbox with WebGL off. A phone draws on its GPU; here software GL (SwiftShader) would
//   take the very CPUs the worker needs. At 4× it must compute ≥ 20 fps: most seconds hold 20 frames, and its
//   median frame fits a 20 fps frame's budget (runtime.js: 80 % of the interval), so the app need not go below 20.
// - points, playa (reported): the 3D view on SwiftShader, Playa at its phone tier (lite). Their fps are software
//   GL's, not a phone GPU's, so they are printed, not judged; the Playa view must not fall back to Points.
// - auto (asserted): the Playa view on Auto with every frame held 35 ms, as on a slow GPU: it must step down to low.
// Every run: no page errors, and no main-thread task of 100 ms or more at its highest slowdown.
//   PERF_RATES=1,4  PERF_SECONDS=11 (odd: a median is a middle second); one run: npm run perf -- -g compute
import { readFile } from 'node:fs/promises';

import { expect, signup, test } from './studio.js';

const RATES = (process.env.PERF_RATES || '1,4').split(',').map(Number);
const SECONDS = Number(process.env.PERF_SECONDS) || 11;
const RUNS = [
  { name: 'compute', gl: false, view: 'points', rates: RATES },
  { name: 'points', gl: true, view: 'points', rates: RATES },
  { name: 'playa', gl: true, view: 'playa', quality: 'lite', rates: RATES },
  { name: 'auto', gl: true, view: 'playa', quality: 'auto', slow: 35, rates: [1] },
];
const MIN_FPS = 20, MAX_TASK_MS = 100;
const FRAME_BUDGET_MS = (0.8 * 1000) / MIN_FPS;     // runtime.js BUDGET at the lowest rate
const WARM_MS = 2000, SETTLE_MS = 6000;
const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
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
// (its last pass, a full-screen triangle onto the canvas; `slow` ms each, if set), record long tasks. The sandbox:
// slow its worker `rate` times, as a phone's core would be (its source is a Blob; the probe goes first). The
// worker's replies keep their order: while a frame is held back, what follows it waits behind it.
function probe({ rate, view, quality = 'auto', slow = 0 }) {
  if (window !== window.top) {
    const Blob0 = Blob;
    const slower = `(() => { const now = performance.now.bind(performance), post = self.postMessage.bind(self);
      let t0 = 0, held = [];
      const flush = () => { const q = held; held = []; for (const [m, transfer] of q) post(m, transfer); };
      self.addEventListener('message', (e) => { if (e.data && e.data.type === 'frame') t0 = now(); });
      self.postMessage = (m, transfer) => {
        if (held.length) return void held.push([m, transfer]);
        if (m && m.type === 'frame' && t0 && ${rate} > 1) {
          const took = now() - t0;
          t0 = 0;
          m.ms *= ${rate};
          for (const id in m.layerMs) m.layerMs[id] *= ${rate};
          held.push([m, transfer]);
          return void setTimeout(flush, (${rate} - 1) * took);
        }
        return post(m, transfer);
      };
    })();\n`;
    window.Blob = function (parts, opts) {
      return new Blob0(opts?.type === 'text/javascript' ? [slower, ...parts] : parts, opts);
    };
    return;
  }
  const p = window.perfProbe = { frames: 0, times: [], ms: [], layers: {}, tasks: [], draws: 0, d0: 0, d1: 0 };
  localStorage.setItem('studio.render', view);
  localStorage.setItem('studio.quality', quality);
  const GL = WebGL2RenderingContext.prototype, bind = GL.bindFramebuffer, drawArrays = GL.drawArrays;
  GL.bindFramebuffer = function (target, fb) { this.perfFb = fb; return bind.call(this, target, fb); };
  GL.drawArrays = function (mode, first, count) {
    if (mode === this.TRIANGLES && count === 3 && !this.perfFb) {
      for (const end = performance.now() + slow; performance.now() < end;);
      if (!p.draws++) p.d0 = performance.now();
      p.d1 = performance.now();
    }
    return drawArrays.call(this, mode, first, count);
  };
  const seen = (e) => {
    if (e.data?.type !== 'frame' || !e.data.rgb) return;
    p.frames++;
    p.times.push(performance.now());
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

async function measure(browser, origin, cookie, lookId, run, rate) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true });
  await context.addCookies([{ name: 'studio_session', value: cookie.split('=')[1], url: origin }]);
  await context.addInitScript(probe, { rate, view: run.view, quality: run.quality, slow: run.slow });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${origin}/studio/${lookId}`);
  await page.waitForFunction(() => window.perfProbe?.frames > 10, null, { timeout: 60_000 });
  await page.waitForTimeout(WARM_MS);
  // The sandbox frame shares the page's process and thread unless the browser isolates it: throttle each.
  for (const f of page.frames()) {
    const cdp = await context.newCDPSession(f).catch(() => null);  // only an out-of-process frame has its own
    await cdp?.send('Emulation.setCPUThrottlingRate', { rate });
  }
  await page.waitForTimeout(SETTLE_MS);
  const start = await page.evaluate(() => {
    Object.assign(window.perfProbe, { frames: 0, times: [], ms: [], layers: {}, tasks: [], draws: 0 });
    return performance.now();
  });
  await page.waitForTimeout(SECONDS * 1000);
  const p = await page.evaluate(() => window.perfProbe);
  const stats = await page.locator('.tp-stats').textContent();
  const heavy = await page.locator('.layer-heavy:not([hidden])').count();
  const mode = await page.locator('.view-modes .mode-btn[aria-pressed=true]').first().getAttribute('data-mode');
  const title = await page.locator('.view-modes .quality-btn').first().getAttribute('title');
  await context.close();
  // Frames per second, second by second over the window, and the median second's.
  const perSecond = Array.from({ length: SECONDS }, (_, s) => p.times
    .filter((t) => t >= start + s * 1000 && t < start + (s + 1) * 1000).length);
  const layerMs = Object.fromEntries(Object.entries(p.layers).map(([id, v]) => [id, median(v)]));
  const tier = (/now (\w+)/.exec(title) || /quality: (\w+)/.exec(title))?.[1];   // Auto says what it is now
  const span = p.times.at(-1) - p.times[0];
  return { run, rate, mode, tier, fps: median(perSecond), perSecond, mean: ((p.frames - 1) * 1000) / span,
    ms: median(p.ms), layerMs, draws: p.draws > 1 ? ((p.draws - 1) * 1000) / (p.d1 - p.d0) : 0,
    longest: Math.max(0, ...p.tasks), tasks: p.tasks.length, stats, heavy, errors };
}

test.use({ serverOptions: { generator: { enqueue() {} },
  renderBox: { probe: async () => ({ ok: false, reason: 'off' }), render: async () => ({}) } } });

let cookie, look;
test.beforeAll(async ({ studio }) => {
  cookie = await signup(studio.origin, 'perf', 'perf-password');
  const made = await fetch(`${studio.origin}/api/looks`, { method: 'POST', body: JSON.stringify(await demoLook()),
    headers: { 'content-type': 'application/json', cookie } });
  if (!made.ok) throw new Error(`the demo look was refused: ${await made.text()}`);
  ({ look } = await made.json());
});

for (const run of RUNS) {
  test(run.name, async ({ playwright, studio }) => {
    // Software GL for the 3D view; none for the sandbox alone.
    const browser = await playwright.chromium.launch({ args: run.gl ? SWIFTSHADER : ['--disable-3d-apis'] });
    const results = [];
    try {
      for (const rate of run.rates) {
        const r = await measure(browser, studio.origin, cookie, look.id, run, rate);
        results.push(r);
        const layers = Object.values(r.layerMs).map((v) => v.toFixed(1)).join(', ');
        const gl = run.gl ? `${r.draws.toFixed(1)} drawn (software GL, for the record), ${r.mode} view`
          + `${r.mode === 'playa' ? ` at ${r.tier}` : ''}` : 'no WebGL';
        log(`${run.name}, ${rate}× CPU: ${r.fps} fps computed (median second of ${r.perSecond.join(' ')}; mean `
          + `${r.mean.toFixed(1)}), ${gl}; worker ${r.ms.toFixed(1)} ms a frame (${(r.ms / rate).toFixed(1)} ms of `
          + `it its own work; layers ${layers} ms), longest task ${r.longest.toFixed(0)} ms (${r.tasks} over 50 ms), `
          + `heavy badges ${r.heavy}; the transport says "${r.stats}"`);
        for (const e of r.errors) log(`page error: ${e}`);
      }
    } finally {
      await browser.close();
    }
    const top = results.find((r) => r.rate === Math.max(...run.rates));
    const at = `${run.name} at ${top.rate}×`;
    const base = results.find((r) => r.rate === 1);
    if (base && top !== base) {   // > 1: the runner's other load (and the page's throttle) slowed the worker's own work
      log(`${run.name}: the worker's own work took ${(top.ms / top.rate / base.ms).toFixed(1)}× as long at `
        + `${top.rate}× as at 1×`);
    }
    if (run.name === 'compute') {
      expect.soft(top.fps, `fps computed (${at}), its median second`).toBeGreaterThanOrEqual(MIN_FPS);
      expect.soft(top.ms, `the worker's ms a frame (${at}) within a ${MIN_FPS} fps frame's budget`)
        .toBeLessThanOrEqual(FRAME_BUDGET_MS);
    }
    expect.soft(top.longest, `the longest main-thread task (${at}), ms`).toBeLessThan(MAX_TASK_MS);
    for (const r of results) {
      if (run.view === 'playa') expect.soft(r.mode, `the view (${run.name} at ${r.rate}×)`).toBe('playa');
      if (run.name === 'auto') expect.soft(r.tier, `Auto's tier on slow frames (at ${r.rate}×)`).toBe('low');
      expect.soft(r.errors, `page errors (${run.name} at ${r.rate}×)`).toEqual([]);
    }
  });
}
