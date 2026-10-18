// Playwright Test fixtures for the smoke and perf specs: `studio`, the real server (src/app.js) on a temporary data
// folder, serving a fresh build of the app (test/fixtures/build.js), one per worker; `serverOptions` are its
// createServer() options (the perf check turns the generator and the render box off).
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { test as base } from '@playwright/test';

import { createServer } from '../../src/app.js';
import { builtApp, removeBuiltApp } from '../fixtures/build.js';

export { expect } from '@playwright/test';
export const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });

export const test = base.extend({
  serverOptions: [{}, { scope: 'worker', option: true }],
  studio: [async ({ serverOptions }, use) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'studio-browser-'));
    const app = await createServer({ dataDir, distDir: await builtApp(), log: quiet, ...serverOptions });
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
