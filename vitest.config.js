// npm test: Vitest runs test/**/*.test.{js,ts} through the app's Vite config (vite.config.js), so tests import `.ts`
// and Vite's own imports (`?sandbox`, styles) as the build does. Root is studio/, not public/ as for the build.
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.js';

export default mergeConfig(viteConfig, defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['test/**/*.test.{js,ts}', 'pi/test/**/*.test.{js,ts}'],
    // Each file in a fresh process of its own: tests start servers, worker threads and render boxes, and read their
    // own threads' nice values from /proc/self. One file per spare CPU, and two on a 2-CPU runner: much of the suite
    // waits on servers and boxes (62 s there against 110 s one at a time), the boxes run at nice 10, and no test
    // holds code to a time: a cost is judged against work timed beside it (spatial.test.js, npm run perf). The bake
    // test counts only its own boxes in /proc, not other files'.
    // Servers draw gallery previews flat (test/previews.test.js tries the Playa camera itself).
    env: { STUDIO_PREVIEWS: 'front' },
    pool: 'forks',
    isolate: true,
    maxWorkers: Math.max(2, availableParallelism() - 1),
    // node:test had no timeouts; these only catch a hang (a render box and a fresh build take seconds, not minutes).
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ['default', './test/skip-reporter.js', ...process.env.GITHUB_ACTIONS ? ['github-actions'] : []],
  },
}));
