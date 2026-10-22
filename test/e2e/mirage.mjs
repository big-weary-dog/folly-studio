// Mirage (and the older cathedral-3d-sim.html) in headless Chromium, for mirage.spec.js: three.js is served from a
// local copy instead of the CDN, WebGL runs on SwiftShader (playwright.config.js), and the running sim's pixel store
// (`window.mirage.app.store`) is read back per pixel with its universe and channel.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';

/** The local three@0.160.0 package: E2E_DEPS is a folder holding node_modules/three (or three itself). */
export function threeDir() {
  const base = process.env.E2E_DEPS;
  for (const dir of base ? [path.join(base, 'node_modules/three'), base] : []) {
    if (existsSync(path.join(dir, 'build/three.module.js'))) {
      const version = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
      if (version !== '0.160.0') throw new Error(`e2e: ${dir} is three ${version}; Mirage pins 0.160.0`);
      return dir;
    }
  }
  throw new Error('e2e: set E2E_DEPS to a folder where `npm install three@0.160.0` was run (the CDN is not used)');
}

/** A context whose jsDelivr three.js requests come from `dir`, and every other remote request fails fast. */
export async function newContext(browser, dir, viewport = { width: 1366, height: 768 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
  await context.route(`${THREE_URL}**`, (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.slice('/npm/three@0.160.0/'.length));
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir + path.sep) || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, body: readFileSync(file),
      headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' } });
  });
  return context;
}

/** Open Mirage and wait until it has booted (window.mirage exists); returns the console errors seen. */
export async function openMirage(page, url, timeout = 240000) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.mirage?.app?.store?.drive, null, { timeout, polling: 500 });
  return errors;
}

/**
 * Mirage's pixel store, per pixel: zone key, universe, 0-based channel within it, position, and the
 * drive it last received (0..1 = DMX / 255). The universe comes from the store's byUniverse index.
 */
async function readStore(page) {
  return page.evaluate(async () => {
    const { store } = window.mirage.app;
    const { ZONE_KEYS } = await import(new URL('src/pixels.js', location.href).href); // the page's own module
    const universe = new Array(store.count).fill(0);
    for (const [u, pixels] of store.byUniverse) for (const p of pixels) universe[p] = u;
    return {
      count: store.count, zoneKeys: ZONE_KEYS, zone: Array.from(store.zone), universe, ch0: Array.from(store.ch0),
      pos: Array.from(store.pos, (v) => Math.round(v * 1000) / 1000), drive: Array.from(store.drive),
      live: window.mirage.live.active,
    };
  });
}

/**
 * Wait until Mirage is live and its drive equals `expected(store) → bytes per pixel` on at least
 * `fraction` of the pixels, or the drive stops changing; returns the last store read.
 */
export async function waitForDrive(page, check, { timeout = 60000, settle = 3 } = {}) {
  let last = null, same = 0, prevSum = -1;
  for (const end = Date.now() + timeout; Date.now() < end;) {
    const s = await readStore(page);
    last = s;
    if (s.live) {
      if (check(s)) return s;
      const sum = s.drive.reduce((a, v) => a + v, 0);
      same = Math.abs(sum - prevSum) < 1e-6 && sum > 0 ? same + 1 : 0;
      prevSum = sum;
      if (same >= settle) return s;
    }
    await page.waitForTimeout(1000);
  }
  return last;
}

/** A views.json view (Target, Distance, Angle, Elevation, Fov) as a Mirage orbit view, framed as the Studio does. */
export function viewFrom(v) {
  const rad = Math.PI / 180, d = v.Distance, flat = d * Math.cos(v.Elevation * rad);
  const [x, y, z] = v.Target;
  const a = v.Angle * rad, e = v.Elevation * rad;
  return { mode: 'orbit', look: [x, y, z], fov: v.Fov,
    pos: [x - flat * Math.cos(a), y + d * Math.sin(e), z + flat * Math.sin(a)] };
}

/** Put Mirage's camera on a view and let it render a few frames; SwiftShader is slow, so wait on frames. */
export async function showView(page, view, frames = 4) {
  await page.evaluate((v) => {
    const { app, camera } = window.mirage;
    app.rig.goTo(v, { instant: true });
    if (v.fov) { camera.fov = v.fov; camera.updateProjectionMatrix(); }
  }, view);
  await waitFrames(page, frames);
}

async function waitFrames(page, n) {
  await page.evaluate((count) => new Promise((resolve) => {
    let left = count;
    const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  }), n);
}
