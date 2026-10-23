// A real dry engine per browser worker: the child reserves its own ephemeral port, reports readiness and is reaped.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { engineOutput } from '../fixtures/engine-output.js';
import { tagged } from './procs.mjs';
import { test as base } from './studio.js';

export { expect, signup } from './studio.js';
const MAIN = fileURLToPath(new URL('../../pi/main.ts', import.meta.url));
export const test = base.extend({
  // Different scenarios need fresh accounts and engine queues, even when their server settings match.
  engineScenario: ['engine', { scope: 'worker', option: true }],
  engineServerOptions: [{ profile: 'pi', admins: 'boss', curators: 'cara' }, { scope: 'worker', option: true }],
  dryEngine: [async ({ engineScenario }, use) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), `pi-config-${engineScenario}-`));
    let child;
    try {
      const config = path.join(dir, 'config.json');
      await writeFile(config, '{}');
      child = spawn(process.execPath, [MAIN, '--dry-run', '--base', '/pi', '--http', 'auto', '--bind', '127.0.0.1',
        '--stats', '1', '--config', config], { env: tagged(), stdio: 'pipe' });
      const output = engineOutput(child.stdout);
      child.stderr.on('data', () => {});
      const exited = once(child, 'exit');
      let timer;
      try {
        await Promise.race([output.ready, exited.then(([code]) => {
          throw new Error(`the Pi exited ${code}: ${output.text()}`);
        }), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Pi startup timed out: ${output.text()}`)), 30_000);
        })]);
      } finally { clearTimeout(timer); }
      const origin = output.text().match(/control page on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (!origin) throw new Error(`No bound engine address: ${output.text()}`);
      await use({ origin, output });
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
      await rm(dir, { recursive: true, force: true });
    }
  }, { scope: 'worker', timeout: 45_000 }],
  serverOptions: [async ({ dryEngine, engineServerOptions }, use) => {
    await use({ ...engineServerOptions, piPreview: dryEngine.origin });
  }, { scope: 'worker' }],
});
