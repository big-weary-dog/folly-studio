import { defineConfig } from '@playwright/test';

process.env.STUDIO_PREVIEWS = 'front';
export default defineConfig({
  testDir: '.', testMatch: 'rose-warps.spec.js', workers: 1, timeout: 600_000,
  outputDir: '/tmp/rose-warps-playwright', reporter: 'list',
  use: { browserName: 'chromium', viewport: { width: 1366, height: 768 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
});
