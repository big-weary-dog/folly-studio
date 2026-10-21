// deploy/host.sh's checks before anything moves: the instances (public, dev, offline) never share a port, a data
// folder or an engine's port, and each runs its own profile. A stand-in systemctl with no user session stops every
// run at that check, so none gets as far as a checkout or a unit.
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

  test('three instances on their own ports, data and engines pass the checks', () => {
    env('studio', [`STUDIO_DATA=${home}/folly-data`, 'PI_PREVIEW_URL=http://127.0.0.1:4043']);
    env('studio-dev', [`STUDIO_DATA=${home}/folly-dev-data`, 'PORT=8781']);
    env('studio-offline', ['STUDIO_PROFILE=pi', `STUDIO_DATA=${home}/folly-offline-data`,
      'PI_PREVIEW_URL=http://127.0.0.1:4045']);
    for (const args of [[], ['--instance', 'dev'], ['--instance', 'offline']]) assert.match(host(...args), STOPPED);
  });

  test('offline runs the Pi profile, the others never do', () => {
    env('studio-offline', [`STUDIO_DATA=${home}/o`]);
    assert.match(host('--instance', 'offline'), /STUDIO_PROFILE=hosted .*the offline studio runs pi/);
    env('studio-dev', ['STUDIO_PROFILE=pi', `STUDIO_DATA=${home}/d`, 'PORT=8781']);
    assert.match(host('--instance', 'dev'), /STUDIO_PROFILE=pi .*the dev studio runs hosted/);
  });

  test('a shared port, data folder or engine port stops it', () => {
    env('studio', [`STUDIO_DATA=${home}/folly-data`, 'PI_PREVIEW_URL=http://127.0.0.1:4043']);
    env('studio-offline', ['STUDIO_PROFILE=pi', 'PORT=8780', `STUDIO_DATA=${home}/o`]);
    assert.match(host('--instance', 'offline'), /PORT=8780 is .*studio\.env's too/);
    env('studio-offline', ['STUDIO_PROFILE=pi', `STUDIO_DATA=${home}/folly-data`]);
    assert.match(host('--instance', 'offline'), /STUDIO_DATA=.*folly-data is .*studio\.env's too/);
    env('studio-offline', ['STUDIO_PROFILE=pi', `STUDIO_DATA=${home}/o`, 'PI_PREVIEW_URL=http://127.0.0.1:4043']);
    assert.match(host('--instance', 'offline'), /port 4043 is .*studio\.env's too/);
    env('studio-offline', ['STUDIO_PROFILE=pi', 'PORT=4043', `STUDIO_DATA=${home}/o`]);
    assert.match(host('--instance', 'offline'), /PORT=4043 is the engine's port in .*studio\.env/);
  });

  test('offline stays on loopback like the rest', () => {
    env('studio-offline', ['STUDIO_PROFILE=pi', 'HOST=0.0.0.0', `STUDIO_DATA=${home}/o`]);
    assert.match(host('--instance', 'offline'), /HOST=0\.0\.0\.0: keep the studio on loopback/);
  });
});
