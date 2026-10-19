// npm run perf: the Studio's live preview on a mid-range phone. The real server on a temporary data folder and a fresh
// build, headless Chromium at 390 × 844, the demo look (a warp, two sources, a mask and globals). Each run counts the
// frames the sandbox answers and the 3D view draws, the worker's ms and the main thread's long tasks, at each CPU
// slowdown.
//
// Calibration (perf-calibrate.js): runners differ about 2× in speed, so in the same page and worker, warm and at full
// speed, the look's frames take turns with a fixed reference workload, and our pattern and core code are held to the
// look's cost as a multiple of the reference's (under a 4× throttle on a busy 2-CPU runner that ratio wandered
// 1.0–1.7×; at full speed it holds 0.9–1.2×). The page runs the reference too, to set its throttle and to check it.
//
// The phone (a slowdown above 1×) is a fixed one, not this runner slowed: a typical runner's core at 1/rate of its
// speed, which runs the reference in RUNNER_REF_MS × rate. Slowing this runner's own times instead slowed its load
// with them: on CI the worker's work took 3.6× as long under the throttle, and that was then multiplied by 4. So the
// phone's worker answers each frame in the look's cost in reference units × the phone's reference time: the probe
// holds the answer back until then (held, not busy-waited: a phone's slow core is its own), and a frame whose own
// work took longer is late. Its page runs under CDP's Emulation.setCPUThrottlingRate (Chrome refuses it for workers)
// at the rate that brings this page's reference time to the phone's. The sandbox's page, a relay doing a fraction of
// a ms a frame, gets no throttle of its own where the browser isolates it: CDP's throttle busy-waits most of a CPU
// even on an idle thread, and on a 2-CPU runner that came out of the worker's share.
//
// Steady state: frames flow for 2 s at full speed first (the JIT warm), then the calibration and the slowdown, 6 s to
// settle (the app steps its rate at most once a second, down from 40 and up again as its average cost settles), then
// a fixed window of 11 s counted second by second. A run's fps is its median second's (the 6th of 11, so most
// seconds reach it): a stalled second or two on a noisy runner do not decide it, a slow pipeline does.
//
// What it asserts, and what it only reports:
// - compute (asserted): the sandbox with WebGL off. A phone draws on its GPU; here software GL (SwiftShader) would
//   take the very CPUs the worker needs. The look must cost ≤ MAX_RATIO × the reference, and on the phone it must run
//   above the app's 20 fps floor (PHONE_FPS). That is judged only where this runner kept up with the phone: its
//   median frame not late and its page within PHONE_SLACK of the phone's reference time; otherwise the runner set the
//   pace, and the fps is reported instead.
// - points, playa (reported): the 3D view on SwiftShader, Playa at its phone tier (lite). Their fps are software
//   GL's, not a phone GPU's, so they are printed, not judged; the Playa view must not fall back to Points.
// - auto (asserted): the Playa view on Auto with every frame held 35 ms, as on a slow GPU: it must step down to low.
// Every run: no page errors, and no main-thread task of 100 ms or more at its highest slowdown.
//   PERF_RATES=1,4  PERF_SECONDS=11 (odd: a median is a middle second); one run: npm run perf -- -g compute
import { readFile } from 'node:fs/promises';

import { calibrator, reference, timer } from './perf-calibrate.js';
import { expect, signup, test } from './studio.js';

const RATES = (process.env.PERF_RATES || '1,4').split(',').map(Number);
const SECONDS = Number(process.env.PERF_SECONDS) || 11;
const RUNS = [
  { name: 'compute', gl: false, view: 'points', rates: RATES },
  { name: 'points', gl: true, view: 'points', rates: RATES },
  { name: 'playa', gl: true, view: 'playa', quality: 'lite', rates: RATES },
  { name: 'auto', gl: true, view: 'playa', quality: 'auto', slow: 35, rates: [1] },
];
const MAX_TASK_MS = 100;
const WARM_MS = 2000, SETTLE_MS = 6000;
// Calibration: at full speed, 32 bursts of 2 look/reference pairs in the worker, each with a reference run on the
// page; as the slowdown settles, 12 more on the page. A burst stays far below the sandbox's 1 s hang budget even on a
// crawling runner; one unanswered in 5 s (a restarted worker) is dropped.
const FULL = { bursts: 32, gap: 50, worker: true }, SLOWED = { bursts: 12, gap: 250, worker: false };
const CAL_PAIRS = 2, CAL_WAIT_MS = 5000;
// The demo look costs 0.9–1.2× the reference (idle, on 2 CPUs, on 2 CPUs with busy processes; 1.0–1.1× on CI); 1.6
// leaves it a third to grow, and a core twice as slow per LED reads 2.1.
const MAX_RATIO = 1.6;
// The reference unloaded on a typical runner (2.9 ms on CI's; 3.0–3.5 on a 2.8 GHz Xeon): × 4, the phone's 12 ms.
const RUNNER_REF_MS = 3;
// The promise: on that phone the look runs above the app's 20 fps floor (runtime.js RATES: 40, 30, 20). A look that
// needs the floor is pinned there, its median second lands on 19–21 by chance and any hiccup drops it below: that
// cannot be judged, and the app has no lower rate to step to. One with headroom steps up to 30 or 40 (its frames
// under 70 % of their budget). So its median second must reach 25: stepped up, and the pipeline keeping up.
const PHONE_FPS = 25;
// Judged where this runner kept up with the phone: the page's reference, throttled, within 25 % of the phone's (CDP's
// throttle compounds the runner's load), and the median frame not late.
const PHONE_SLACK = 1.25;
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
// answer each frame as the phone's worker would, once told its time a frame (`perf-phone`): held back until then
// from the request, its reported times scaled to it; one whose own work took longer goes as soon as it is done (its
// source is a Blob; the probe goes first). The replies keep their order: what follows a held frame waits behind it.
function probe({ view, quality = 'auto', slow = 0, calibrator, timer, reference }) {
  if (window !== window.top) {
    const Blob0 = Blob, Worker0 = Worker;
    const slower = `(() => { const now = performance.now.bind(performance), post = self.postMessage.bind(self);
      const calibration = (${calibrator})((${timer})(${reference}), post);
      let t0 = 0, phone = 0, held = [];
      const flush = () => { const q = held; held = []; for (const [m, transfer] of q) post(m, transfer); };
      self.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'frame') t0 = now();
        if (e.data && e.data.type === 'perf-phone') phone = e.data.ms;
      });
      self.postMessage = (m, transfer) => {
        if (calibration(m)) return;
        if (held.length) return void held.push([m, transfer]);
        if (m && m.type === 'frame' && t0 && phone) {
          const ms = Math.max(m.ms, phone), k = m.ms > 0 ? ms / m.ms : 1, at = t0 + ms;
          t0 = 0;
          m.ms = ms;
          for (const id in m.layerMs) m.layerMs[id] *= k;
          held.push([m, transfer]);
          return void setTimeout(flush, at - now());
        }
        return post(m, transfer);
      };
    })();\n`;
    window.Blob = function (parts, opts) {
      return new Blob0(opts?.type === 'text/javascript' ? [slower, ...parts] : parts, opts);
    };
    // The calibration, asked of the pattern worker from the test: its answer, or null after `wait` ms.
    window.Worker = class extends Worker0 {
      constructor(url, opts) {
        super(url, opts);
        if (opts?.name !== 'folly-patterns') return;
        window.perfWorker = this;
        if (window.perfPhoneMs) this.postMessage({ type: 'perf-phone', ms: window.perfPhoneMs });  // a restarted one
      }
    };
    window.perfPhone = (ms) => {
      window.perfPhoneMs = ms;
      window.perfWorker.postMessage({ type: 'perf-phone', ms });
    };
    window.perfCalibrate = (pairs, flip, wait) => new Promise((resolve) => {
      const w = window.perfWorker;
      const done = (answer) => { clearTimeout(late); w.removeEventListener('message', on); resolve(answer); };
      const on = (e) => { if (e.data?.type === 'perf-calibrated') done(e.data); };
      const late = setTimeout(done, wait, null);
      w.addEventListener('message', on);
      w.postMessage({ type: 'perf-calibrate', pairs, flip });
    });
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
const sandboxOf = (page) => page.frames().find((f) => f.url().includes('/sandbox'));

/**
 * The calibration: `bursts` of reference runs on the page, each after two look/reference pairs in the sandbox's
 * worker if `worker`. The look's cost as a multiple of the reference's (the median pair's: a stall spoils a pair, not
 * the lot; a frame that ran no layer counts for nothing) and the page's median ms for the reference; NaN for none.
 */
async function calibrate(page, { bursts, gap, worker }) {
  const sandbox = sandboxOf(page);
  const ratios = [], main = [];
  for (let n = 0; n < bursts; n++) {
    const r = worker ? await sandbox?.evaluate((a) => window.perfCalibrate(...a), [CAL_PAIRS, n % 2, CAL_WAIT_MS])
      : null;
    for (const [i, ms] of (r?.look ?? []).entries()) if (ms > 0) ratios.push(ms / r.ref[i]);
    main.push(await page.evaluate(() => window.perfTime(performance.now() / 1000)));
    await page.waitForTimeout(gap);
  }
  const mid = (a) => (a.length ? median(a) : NaN);
  return { ratio: mid(ratios), page: mid(main) };
}

async function measure(browser, origin, cookie, lookId, run, rate) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true });
  await context.addCookies([{ name: 'studio_session', value: cookie.split('=')[1], url: origin }]);
  await context.addInitScript(probe, { view: run.view, quality: run.quality, slow: run.slow,
    calibrator: String(calibrator), timer: String(timer), reference: String(reference) });
  await context.addInitScript({ content: `window.perfTime = (${timer})(${reference});` });   // on the page's thread
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${origin}/studio/${lookId}`);
  await page.waitForFunction(() => window.perfProbe?.frames > 10, null, { timeout: 60_000 });
  await page.waitForTimeout(WARM_MS);
  const full = await calibrate(page, FULL);
  // The phone: its reference time, its worker's time a frame for this look, and the page's throttle to match.
  const phone = rate > 1 && Number.isFinite(full.ratio) ? { ref: RUNNER_REF_MS * rate } : null;
  if (phone) {
    Object.assign(phone, { frame: full.ratio * phone.ref, cpu: Math.max(1, phone.ref / full.page) });
    await sandboxOf(page).evaluate((ms) => window.perfPhone(ms), phone.frame);
    await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: phone.cpu });
  }
  const [slowed] = await Promise.all([calibrate(page, SLOWED), page.waitForTimeout(SETTLE_MS)]);
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
    ms: median(p.ms), ratio: full.ratio, phone, pageRef: slowed.page, layerMs,
    late: phone ? p.ms.filter((ms) => ms > phone.frame * 1.001).length / p.ms.length : 0,
    draws: p.draws > 1 ? ((p.draws - 1) * 1000) / (p.d1 - p.d0) : 0,
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
        const ph = r.phone && `; as the phone (the reference in ${r.phone.ref} ms): ${r.phone.frame.toFixed(1)} ms a `
          + `frame, ${(100 * r.late).toFixed(0)} % of them late, the page at ${r.phone.cpu.toFixed(1)}× CPU running `
          + `the reference in ${r.pageRef.toFixed(1)} ms`;
        log(`${run.name}, ${rate}× CPU: ${r.fps} fps computed (median second of ${r.perSecond.join(' ')}; mean `
          + `${r.mean.toFixed(1)}), ${gl}; worker ${r.ms.toFixed(1)} ms a frame (layers ${layers} ms), longest task `
          + `${r.longest.toFixed(0)} ms (${r.tasks} over 50 ms), heavy badges ${r.heavy}; the transport says `
          + `"${r.stats}"; the look costs ${r.ratio.toFixed(2)}× the reference${ph || ''}`);
        for (const e of r.errors) log(`page error: ${e}`);
      }
    } finally {
      await browser.close();
    }
    const top = results.find((r) => r.rate === Math.max(...run.rates));
    const at = `${run.name} at ${top.rate}×`;
    if (run.name === 'compute') {
      expect.soft(top.ratio, `the demo look's cost (${run.name}, at full speed) as a multiple of the reference's`)
        .toBeLessThanOrEqual(MAX_RATIO);
      const { phone } = top;
      const slow = phone && [
        top.pageRef > PHONE_SLACK * phone.ref && `the page ran the reference in ${top.pageRef.toFixed(1)} ms`,
        top.late > 0.5 && `${(100 * top.late).toFixed(0)} % of the worker's frames took longer than the phone's`,
      ].filter(Boolean);
      if (phone && !slow.length) {
        expect.soft(top.fps, `fps computed as the phone (${at}), its median second, over the 20 fps floor`)
          .toBeGreaterThanOrEqual(PHONE_FPS);
      } else if (phone) {
        const why = `${top.fps} fps (${at}) not judged: this runner did not keep up with the phone `
          + `(${slow.join('; ')})`;
        log(why);
        test.info().annotations.push({ type: 'not judged', description: why });
      }
    }
    expect.soft(top.longest, `the longest main-thread task (${at}), ms`).toBeLessThan(MAX_TASK_MS);
    for (const r of results) {
      if (run.view === 'playa') expect.soft(r.mode, `the view (${run.name} at ${r.rate}×)`).toBe('playa');
      if (run.name === 'auto') expect.soft(r.tier, `Auto's tier on slow frames (at ${r.rate}×)`).toBe('low');
      expect.soft(r.errors, `page errors (${run.name} at ${r.rate}×)`).toEqual([]);
    }
  });
}
