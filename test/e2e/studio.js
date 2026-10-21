// Playwright Test fixtures for the smoke and perf specs: `studio`, the real server (src/app.ts) on a temporary data
// folder, serving a fresh build of the app (test/fixtures/build.js), one per worker; `serverOptions` are its
// createServer() options (the perf check turns the generator and the render box off). Without its own `models`, a spec
// gets no real codex or Claude, whatever this machine has: Sketch, an admin's, is the one model.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { test as base } from '@playwright/test';

import { createServer } from '../../src/app.ts';
import { builtApp, removeBuiltApp } from '../fixtures/build.js';

export { expect } from '@playwright/test';
export const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });

export const test = base.extend({
  serverOptions: [{}, { scope: 'worker', option: true }],
  // The tutorial's welcome opens for a new account; every context starts as a browser that has shown it, unless a
  // spec asks for it (tour.spec.js).
  tourWelcome: [false, { scope: 'worker', option: true }],
  browser: [async ({ browser, tourWelcome }, use) => {
    if (!tourWelcome) {
      const make = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const context = await make(options);
        await context.addInitScript(() => { try { localStorage.setItem('studio.tour.welcomed', '1'); } catch {} });
        return context;
      };
    }
    await use(browser);
  }, { scope: 'worker' }],
  studio: [async ({ serverOptions }, use) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'studio-browser-'));
    const app = await createServer({ dataDir, distDir: await builtApp(), log: quiet,
      models: { codexBin: 'no-codex-here', env: {} }, ...serverOptions });
    const { port } = await app.listen(0, '127.0.0.1');
    await use({ app, origin: `http://127.0.0.1:${port}` });
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
    await removeBuiltApp();
  }, { scope: 'worker', timeout: 120_000 }],
});

/** A new account on the server: its session cookie (`studio_session=…`). */
export async function signup(origin, username, password = 'correct horse') {
  const res = await fetch(`${origin}/api/signup`, { method: 'POST', body: JSON.stringify({ username, password }),
    headers: { 'content-type': 'application/json' } });
  if (res.status !== 201) throw new Error(`signup ${username}: ${res.status} ${await res.text()}`);
  return res.headers.getSetCookie()[0].split(';')[0];
}
