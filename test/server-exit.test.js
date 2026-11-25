// server.ts on an uncaught exception: it logs it, saves and closes, and exits 1, for systemd's Restart=on-failure
// (docs/HOSTING.md "Monitoring"). A preload throws once the server listens.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, test } from 'vitest';

const SERVER = fileURLToPath(new URL('../server.ts', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'studio-exit-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test('an uncaught exception exits 1 after saving and closing', () => {
  const preload = path.join(tmp, 'boom.mjs');
  writeFileSync(preload, `const log = console.log;
console.log = (...a) => {
  log(...a);
  if (String(a[0]).includes('Folly Studio on')) setImmediate(() => { throw new Error('boom'); });
};
`);
  const data = path.join(tmp, 'data');
  const r = spawnSync(process.execPath, ['--import', preload, SERVER], { encoding: 'utf8', timeout: 30_000,
    env: { PATH: process.env.PATH, HOME: tmp, PORT: '0', STUDIO_DATA: data } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /\[studio\] uncaught exception, exiting: Error: boom/);
  assert.ok(existsSync(data) && !existsSync(path.join(data, 'studio.lock')), 'closed: its lock released');
});
