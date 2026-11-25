// The app as `npm run build` makes it (vite.config.js), into a temporary folder, so the tests serve what the sources
// make now, never a stale dist/: built once per test process, or once per browser-check run when its global setup
// (test/e2e/setup.mjs) names its build in STUDIO_BUILT_APP.
import { rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

const CONFIG = fileURLToPath(new URL('../../vite.config.js', import.meta.url));
let built = null;

/** Build the app into `outDir` (about a second). */
export async function buildApp(outDir) {
  await build({ configFile: CONFIG, configLoader: 'native', logLevel: 'warn', build: { outDir } });
  return outDir;
}

/** builtApp() → the folder holding the build: the run's own, else this process's (built the first time). */
export function builtApp() {
  if (process.env.STUDIO_BUILT_APP) return Promise.resolve(process.env.STUDIO_BUILT_APP);
  built ||= (async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'studio-dist-'));
    process.once('exit', () => rmSync(outDir, { recursive: true, force: true }));  // unless removeBuiltApp() did
    return buildApp(outDir);
  })();
  return built;
}

/** Remove this process's build, in a test file's afterAll: Vitest stops a file's process with a signal, so `exit`
 * never runs. A run's own build is its global setup's to remove. */
export async function removeBuiltApp() {
  if (built) await rm(await built, { recursive: true, force: true });
  built = null;
}
