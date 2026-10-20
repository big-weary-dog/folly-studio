// The control page the Pi serves is committed as built (pi/page/dist: the Pi installs no Vite): it must be what
// pi/page builds to now. Stale, run `npm run pi:page` and commit the result.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { onTestFinished, test } from 'vitest';

const DIST = fileURLToPath(new URL('../page/dist', import.meta.url));

test('pi/page/dist is what pi/page builds to', async () => {
  const { build } = await import('vite');
  const out = mkdtempSync(path.join(tmpdir(), 'pi-page-'));
  // As `vite build` runs: Vitest's NODE_ENV (test) would resolve Preact's debug build.
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  onTestFinished(() => { process.env.NODE_ENV = env; });
  await build({ configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)), logLevel: 'silent',
    build: { outDir: out, emptyOutDir: true } });
  const files = (dir: string) => readdirSync(dir).sort();
  assert.deepEqual(files(DIST), files(out), 'run npm run pi:page and commit pi/page/dist');
  for (const f of files(out)) {
    assert.ok(readFileSync(path.join(DIST, f)).equals(readFileSync(path.join(out, f))),
      `pi/page/dist/${f} is stale: run npm run pi:page and commit it`);
  }
}, 120_000);
