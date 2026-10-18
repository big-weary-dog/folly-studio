// The app as `npm run build` makes it (vite.config.js), built once per test process into a temporary folder, so
// the tests serve what the sources make now, never a stale dist/.
import { rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

const CONFIG = fileURLToPath(new URL('../../vite.config.js', import.meta.url));
let built = null;

/** builtApp() → the folder holding the build (about a second the first time). */
export function builtApp() {
  built ||= (async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'studio-dist-'));
    process.once('exit', () => rmSync(outDir, { recursive: true, force: true }));  // unless removeBuiltApp() did
    await build({ configFile: CONFIG, configLoader: 'native', logLevel: 'warn', build: { outDir } });
    return outDir;
  })();
  return built;
}

/** Remove the build, in a test file's afterAll: Vitest stops a file's process with a signal, so `exit` never runs. */
export async function removeBuiltApp() {
  if (built) await rm(await built, { recursive: true, force: true });
  built = null;
}
