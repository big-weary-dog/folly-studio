// Playwright's global setup: sweep what ended runs left (procs.mjs), then build the app once for the whole run, for
// every worker to serve (STUDIO_BUILT_APP, test/fixtures/build.js); a worker restarts whenever a spec's worker options
// change, and building in each would cost seconds every time. The folder is named for this run, so if the run dies
// the next sweep removes it; the returned teardown removes it otherwise.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildApp } from '../fixtures/build.js';
import sweepAll, { OUT_PREFIX } from './procs.mjs';

export default async function setup() {
  sweepAll();
  const outDir = await mkdtemp(path.join(os.tmpdir(), `${OUT_PREFIX}${process.pid}-dist-`));
  process.env.STUDIO_BUILT_APP = await buildApp(outDir);
  return () => rm(outDir, { recursive: true, force: true });
}
