// Playwright browser checks: npm run smoke (laptop and phone), perf (phone preview), e2e (sACN into Mirage).
// Separate from npm test. @playwright/test 1.56.1 pins Chromium 141, build 1194.
// PLAYWRIGHT_BROWSERS_PATH defaults to /opt/pw-browsers when present; CI can run npx playwright install chromium.
// Nothing is downloaded at run time.
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
      'aimode.spec.js', 'relay.spec.js', 'gallery.spec.js', 'describe.spec.js', 'param-petals.spec.js',
      'approve.spec.js', 'relay-studio.spec.js', 'baking.spec.js', 'stats.spec.js', 'pages-ux.spec.js',
      'composite.spec.js', 'attached.spec.js', 'custom-code.spec.js', 'guest.spec.js', 'pi-startup.spec.js',
      'param-controls.spec.js', 'phone-cuts.spec.js'],
      timeout: 5 * 60_000 },
    { name: 'perf', testMatch: ['perf.spec.js', 'library-perf.spec.js'], timeout: 5 * 60_000 },
    { name: 'e2e', testMatch: 'mirage.spec.js', timeout: 20 * 60_000 },
  ],
});
