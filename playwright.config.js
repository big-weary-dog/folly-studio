// The browser checks, on Playwright Test and Chromium: `npm run smoke` (the app at a laptop's and a phone's size),
// `npm run perf` (the preview on an emulated phone) and `npm run e2e` (our bytes through sACN into Mirage). Not in
// `npm test`. @playwright/test is pinned to the browsers it was built with (1.56.1: Chromium 141, build 1194): they
// come from PLAYWRIGHT_BROWSERS_PATH (here /opt/pw-browsers, found without it), or from `npx playwright install
// chromium` on CI. Nothing is downloaded at run time.
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defineConfig } from '@playwright/test';

import { OUT_PREFIX } from './test/e2e/procs.mjs';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
}
const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
// Screenshots and traces, a folder per run (made here, in the runner; its workers inherit the name), so runs side by
// side never share or clean each other's files. CI names its own.
process.env.STUDIO_PW_OUT ||= mkdtempSync(path.join(os.tmpdir(), `${OUT_PREFIX}${process.pid}-`));
// Servers started here draw gallery previews flat, without a browser of their own.
process.env.STUDIO_PREVIEWS ||= 'front';

export default defineConfig({
  testDir: 'test/e2e',
  outputDir: process.env.STUDIO_PW_OUT,
  // Before and after: helpers whose worker has gone are killed, and ended runs' folders removed (test/e2e/procs.mjs).
  globalSetup: './test/e2e/procs.mjs',
  globalTeardown: './test/e2e/procs.mjs',
  // One test at a time: the perf check measures the machine, and software GL (SwiftShader) takes every CPU it gets.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: { browserName: 'chromium', launchOptions: { args: SWIFTSHADER }, trace: 'retain-on-failure' },
  projects: [
    { name: 'smoke', testMatch: ['smoke.spec.js', 'models.spec.js', 'light.spec.js', 'access.spec.js', 'live.spec.js',
      'refine.spec.js', 'side.spec.js', 'pi.spec.js', 'explore.spec.js', 'live-trouble.spec.js',
      'live-pi.spec.js', 'loop.spec.js', 'mods.spec.js', 'param-lines.spec.js', 'mod-pop.spec.js', 'report.spec.js',
      'history.spec.js', 'look-energy.spec.js', 'offline.spec.js', 'tour.spec.js', 'lights.spec.js', 'jukebox.spec.js',
      'aimode.spec.js'],
      timeout: 5 * 60_000 },
    { name: 'perf', testMatch: ['perf.spec.js', 'library-perf.spec.js'], timeout: 5 * 60_000 },
    { name: 'e2e', testMatch: 'mirage.spec.js', timeout: 20 * 60_000 },
  ],
});
