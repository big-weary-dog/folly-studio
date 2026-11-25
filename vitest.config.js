// npm test: Vitest runs test/**/*.test.{js,ts} through the app's Vite config (vite.config.js), so tests import `.ts`
// and Vite's own imports (`?sandbox`, styles) as the build does. Root is the repo root, not public/ as for the build.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.js';

/** How many forks of ~170 MB at peak fit, keeping 400 MB spare, under the tightest memory limit of this process's
 * cgroups (v2): Infinity when none is set or none can be read. */
function forksThatFit(fit = Infinity) {
  try {
    // Up to and including the mount's root: a container's own limit sits there (its /proc/self/cgroup says 0::/).
    const root = '/sys/fs/cgroup';
    for (let dir = path.join(root, readFileSync('/proc/self/cgroup', 'utf8').trim().split(':').pop());
      dir.startsWith(root); dir = path.dirname(dir)) {
      const [max, used] = ['max', 'current'].map((f) => Number(readFileSync(`${dir}/memory.${f}`, 'utf8')));
      if (Number.isFinite(max)) fit = Math.min(fit, Math.floor((max - used - 400e6) / 170e6));   // "max" is NaN
    }
  } catch { /* not Linux, cgroup v1, or the host's root, which has no limit files */ }
  return fit;
}

export default mergeConfig(viteConfig, defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Vitest runs the files that took longest last time first, from its results cache under here. Outside the checkout,
  // so a fresh checkout (a new worktree, the gate's) starts in that order too, not with the smallest files last.
  cacheDir: path.join(os.homedir(), '.cache', 'folly-studio', 'vitest'),
  test: {
    include: ['test/**/*.test.{js,ts}', 'pi/test/**/*.test.{js,ts}'],
    // Each file in a fresh process of its own: tests start servers, worker threads and render boxes, and read their
    // own threads' nice values from /proc/self. One file per spare CPU, at most 8 and at least 2, and no more than
    // the memory left fits: 15 forks peak at ~2.4 GB, 8 at ~1.8 GB, and more than 8 gain little on a shared machine.
    // Much of the suite waits on servers and boxes, the boxes run at nice 10, and no test holds code to a time: a cost
    // is judged against work timed beside it (spatial.test.js, npm run perf). The bake test counts only its own boxes
    // in /proc, not other files'. VITEST_MAX_WORKERS overrides this.
    // Servers draw gallery previews flat (test/previews.test.js tries the Playa camera itself).
    env: { STUDIO_PREVIEWS: 'front' },
    pool: 'forks',
    isolate: true,
    maxWorkers: Math.max(2, Math.min(os.availableParallelism() - 1, 8, forksThatFit())),
    // node:test had no timeouts; these only catch a hang (a render box and a fresh build take seconds, not minutes).
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ['default', './test/skip-reporter.js', ...process.env.GITHUB_ACTIONS ? ['github-actions'] : []],
  },
}));
