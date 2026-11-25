// Playwright Test fixtures for the smoke and perf specs: `studio`, the real server (src/app.ts) on a temporary data
// folder, serving the run's fresh build of the app (test/e2e/setup.mjs), one per worker; `serverOptions` are its
// createServer() options (the perf check turns the render box off).
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test as base } from '@playwright/test';

import { serve } from '../fixtures/app.js';
import { builtApp } from '../fixtures/build.js';

export { expect };

// Every context a test opens is closed when it ends, passed or failed, so no page keeps rendering into the next.
const opened = new Set();

export const test = base.extend({
  serverOptions: [{}, { scope: 'worker', option: true }],
  // The tutorial's welcome opens for a new account; every context starts as a browser that has shown it, unless a
  // spec asks for it (tour.spec.js).
  tourWelcome: [false, { scope: 'worker', option: true }],
  browser: [async ({ browser, tourWelcome }, use) => {
    const make = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const context = await make(options);
      opened.add(context);
      context.on('close', () => opened.delete(context));
      if (!tourWelcome) {
        await context.addInitScript(() => { try { localStorage.setItem('studio.tour.welcomed', '1'); } catch {} });
      }
      return context;
    };
    await use(browser);
  }, { scope: 'worker' }],
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's needs from this pattern: it needs none
  closeContexts: [async ({}, use) => {
    await use();
    await Promise.all([...opened].map((context) => context.close()));
  }, { auto: true }],
  studio: [async ({ serverOptions }, use) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'studio-browser-'));
    const app = await serve({ dataDir, distDir: await builtApp(), ...serverOptions });
    await use({ app, origin: app.base });
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }, { scope: 'worker', timeout: 120_000 }],
});

/** A new account on the server: its session cookie (`studio_session=…`). */
export async function signup(origin, username, password = 'correct horse') {
  const res = await fetch(`${origin}/api/signup`, { method: 'POST', body: JSON.stringify({ username, password }),
    headers: { 'content-type': 'application/json' } });
  if (res.status !== 201) throw new Error(`signup ${username}: ${res.status} ${await res.text()}`);
  return res.headers.getSetCookie()[0].split(';')[0];
}

/** Signs `username` up in `request`'s context (a page's or a browser context's), which keeps its session. */
export async function signupIn(request, origin, username, password = 'correct horse') {
  const res = await request.post(`${origin}/api/signup`, { data: { username, password } });
  expect(res.status(), `signup ${username}`).toBe(201);
  return res;
}

/** Signs a browser context in with an account's session cookie (`signup`'s). */
export async function signIn(context, origin, cookie) {
  const [name, value] = cookie.split('=');
  await context.addCookies([{ name, value, url: origin }]);
}
