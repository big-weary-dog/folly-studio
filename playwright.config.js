// The browser checks, on Playwright Test and Chromium: `npm run smoke` (the app at a laptop's and a phone's size),
// `npm run perf` (the preview on an emulated phone) and `npm run e2e` (our bytes through sACN into Mirage). Not in
// `npm test`. @playwright/test is pinned to the browsers it was built with (1.56.1: Chromium 141, build 1194): they
// come from PLAYWRIGHT_BROWSERS_PATH (here /opt/pw-browsers, found without it), or from `npx playwright install
// chromium` on CI. Nothing is downloaded at run time.
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defineConfig } from '@playwright/test';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
}
const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'test/e2e',
  outputDir: path.join(os.tmpdir(), 'folly-studio-playwright'),   // screenshots and traces of failures
  // One test at a time: the perf check measures the machine, and software GL (SwiftShader) takes every CPU it gets.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: { browserName: 'chromium', launchOptions: { args: SWIFTSHADER }, trace: 'retain-on-failure' },
  projects: [
    { name: 'smoke', testMatch: 'smoke.spec.js', timeout: 5 * 60_000 },
    { name: 'perf', testMatch: 'perf.spec.js', timeout: 5 * 60_000 },
    { name: 'e2e', testMatch: 'mirage.spec.js', timeout: 20 * 60_000 },
  ],
});
