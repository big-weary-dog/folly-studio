// deploy/host.sh's checks before anything moves: the instances (public, dev) never share a port or a data folder,
// and stay on loopback. A stand-in systemctl with no user session stops every run at that check, so none gets as far
// as a checkout or a unit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, test } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../deploy/host.sh', import.meta.url));
const STOPPED = /no systemd user session/;

describe('npm run host: the instances', () => {
  let home, settings, bin;
  const env = (name, lines) => {
    const f = path.join(settings, `${name}.env`);
    writeFileSync(f, `${lines.join('\n')}\n`);
    chmodSync(f, 0o600);
  };
  const host = (...args) => {
    const r = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, STUDIO_INSTANCE: '' } });
    return r.stderr;
  };
  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'host-'));
    settings = path.join(home, '.config', 'folly-studio');
    bin = path.join(home, 'bin');
    mkdirSync(settings, { recursive: true });
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'systemctl'), '#!/bin/sh\nexit 1\n');
    chmodSync(path.join(bin, 'systemctl'), 0o755);
    return () => rmSync(home, { recursive: true, force: true });
  });

  test('two instances on their own ports and data pass the checks', () => {
    env('studio', [`STUDIO_DATA=${home}/folly-data`]);
    env('studio-dev', [`STUDIO_DATA=${home}/folly-dev-data`]);
    for (const args of [[], ['--instance', 'dev']]) assert.match(host(...args), STOPPED);
  });

  test('a shared port or data folder stops it', () => {
    env('studio', [`STUDIO_DATA=${home}/folly-data`]);
    env('studio-dev', ['PORT=8780', `STUDIO_DATA=${home}/d`]);
    assert.match(host('--instance', 'dev'), /PORT=8780 is .*studio\.env's too/);
    env('studio-dev', [`STUDIO_DATA=${home}/folly-data`]);
    assert.match(host('--instance', 'dev'), /STUDIO_DATA=.*folly-data is .*studio\.env's too/);
  });

  test('only the dev instance, and loopback only', () => {
    assert.match(host('--instance', 'offline'), /--instance offline: the instance is dev/);
    env('studio-dev', ['HOST=0.0.0.0', `STUDIO_DATA=${home}/d`]);
    assert.match(host('--instance', 'dev'), /HOST=0\.0\.0\.0: keep the studio on loopback/);
  });
});
