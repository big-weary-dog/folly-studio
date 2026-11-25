// deploy/host.sh's releases: each commit is built in releases/<commit>, a worktree of the checkout, and the service
// moves to it only once it has built and passed the settings check; --rollback goes back to the one before, and old
// releases are pruned. Real git on a scratch origin; npm, node, systemctl and curl are stand-ins that log their calls.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../deploy/host.sh', import.meta.url));
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
const STUBS = {
  npm: 'echo "npm $*" >> "$LOG"; case $1 in ci) mkdir -p node_modules;; run) mkdir -p dist;; esac',
  node: 'echo "node $*" >> "$LOG"; [ "$1" != tools/config-check.ts ] || [ -z "$REFUSE" ] || '
    + '{ echo PORT >&2; exit 1; }; [ "$1" != node_modules/playwright-core/cli.js ] || [ -z "$OLD_PLAYWRIGHT" ] || '
    + '[ -n "$PLAYWRIGHT_HOST_PLATFORM_OVERRIDE" ] || { echo "ERROR: Playwright does not support this OS"; exit 1; }',
  systemctl: 'echo "systemctl $*" >> "$LOG"; [ "$2" != is-failed ]',
  curl: 'case "$*" in *build.json*) cat "$CHECKOUT/current/dist/build.json";; '
    + '*api/me*) printf \'{"user":null}\\n200\';; esac',
  journalctl: 'true',
};

describe('npm run host: releases', () => {
  let origin, before, commits, home, checkout, log;
  beforeAll(() => {
    origin = mkdtempSync(path.join(tmpdir(), 'host-origin-'));
    git(origin, 'init', '--quiet');
    mkdirSync(path.join(origin, 'deploy'));
    copyFileSync(fileURLToPath(new URL('../.gitignore', import.meta.url)), path.join(origin, '.gitignore'));
    // A commit whose host.sh predates releases, then four that know them.
    writeFileSync(path.join(origin, 'deploy', 'host.sh'), '#!/usr/bin/env bash\n');
    git(origin, 'add', '.');
    git(origin, 'commit', '--quiet', '-m', 'before');
    before = git(origin, 'rev-parse', 'HEAD');
    copyFileSync(SCRIPT, path.join(origin, 'deploy', 'host.sh'));
    mkdirSync(path.join(origin, 'tools'));
    for (const file of ['deploy/backup.sh', 'tools/backup.ts'])
      copyFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), path.join(origin, file));
    commits = ['a', 'b', 'c', 'd'].map((name) => {
      writeFileSync(path.join(origin, 'version'), name);
      git(origin, 'add', '.');
      git(origin, 'commit', '--quiet', '-m', name);
      return git(origin, 'rev-parse', 'HEAD');
    });
  });
  afterAll(() => rmSync(origin, { recursive: true, force: true }));
  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'host-'));
    checkout = path.join(home, 'folly');
    log = path.join(home, 'log');
    git(home, 'clone', '--quiet', origin, checkout);
    const settings = path.join(home, '.config', 'folly-studio');
    mkdirSync(settings, { recursive: true });
    writeFileSync(path.join(settings, 'studio.env'),
      ['STUDIO_DATA="my data"', 'STUDIO_MODELS=data/models.json', ''].join('\n'));
    chmodSync(path.join(settings, 'studio.env'), 0o600);
    mkdirSync(path.join(home, 'bin'));
    for (const [name, body] of Object.entries(STUBS))
      writeFileSync(path.join(home, 'bin', name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    return () => rmSync(home, { recursive: true, force: true });
  });

  const host = (args, extra = {}, wrap = []) => {
    writeFileSync(log, '');
    const command = [...wrap, 'bash', path.join(checkout, 'deploy', 'host.sh'), ...args];
    const env = { ...GIT_ENV, HOME: home, PATH: `${home}/bin:${process.env.PATH}`, STUDIO_INSTANCE: '', LOG: log };
    const r = spawnSync(command[0], command.slice(1), { encoding: 'utf8', timeout: 30_000,
      env: { ...env, CHECKOUT: checkout, ...extra } });
    return { status: r.status, out: r.stdout + r.stderr, calls: readFileSync(log, 'utf8') };
  };
  const ok = (args, extra, r = host(args, extra)) => (assert.equal(r.status, 0, r.out), r);
  const link = (name) => readlinkSync(path.join(checkout, name));
  // The commits exist once beforeAll has run.
  const [a, b, c, d] = [0, 1, 2, 3].map((i) => () => commits[i]);

  test('builds in its own release, then points the unit at current', () => {
    const r = ok([a()]);
    assert.equal(link('current'), `releases/${a()}`);
    assert.match(r.calls, /npm ci[\s\S]*npm run --silent build[\s\S]*config-check[\s\S]*systemctl --user restart/);
    assert.ok(existsSync(path.join(checkout, 'releases', a(), 'dist', 'build.json')));
    assert.ok(!existsSync(path.join(checkout, 'node_modules')) && !existsSync(path.join(checkout, 'dist')));
    assert.equal(git(checkout, 'status', '--porcelain'), '');
    const unit = readFileSync(path.join(home, '.config', 'systemd', 'user', 'folly-studio.service'), 'utf8');
    assert.match(unit, new RegExp(`^WorkingDirectory=${checkout}/current$`, 'm'));
    // The data folder is the checkout's, not the release's, as one argument; a retired setting is left alone.
    assert.ok(unit.includes(`\nExecStart=/usr/bin/env "STUDIO_DATA=${checkout}/my data" /`), unit);
    assert.match(unit, /^Restart=on-failure$/m);
  });

  test('writes and starts the daily backup timer, whose backup outlives a rollback to a release without one', () => {
    const r = ok([a()]);
    const units = path.join(home, '.config', 'systemd', 'user');
    const service = readFileSync(path.join(units, 'folly-studio-backup.service'), 'utf8');
    // Outside the checkout: an older release's host.sh takes a unit in current or the checkout for another instance's.
    const runner = path.join(home, '.local', 'share', 'folly-studio', 'folly-studio-backup');
    assert.match(service, new RegExp(`^WorkingDirectory=${runner}$`, 'm'));
    const command = `/usr/bin/env "STUDIO_DATA=${checkout}/my data" "STUDIO_BACKUP_DIR=${checkout}/my data-backups" `
      + 'bash deploy/backup.sh';
    assert.ok(service.includes(`\nExecStart=${command}\n`), service);
    const timer = readFileSync(path.join(units, 'folly-studio-backup.timer'), 'utf8');
    assert.match(timer, /^OnCalendar=\*-\*-\* 04:15$[\s\S]*^Persistent=true$/m);
    assert.match(r.calls,
      /enable --quiet folly-studio folly-studio-backup\.timer[\s\S]*restart folly-studio-backup\.timer/);
    ok([b()]);
    ok(['--rollback']);
    // The unit's command with no release to run from, as after a rollback to one from before the timer.
    rmSync(path.join(checkout, 'releases'), { recursive: true });
    mkdirSync(path.join(checkout, 'my data'));
    writeFileSync(path.join(checkout, 'my data', 'users.json'), '[]\n');
    const run = spawnSync('sh', ['-c', command], { cwd: runner, encoding: 'utf8', timeout: 30_000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.equal(readdirSync(path.join(checkout, 'my data-backups')).length, 1);
  });

  test('a refused setting leaves the live release and the service as they were', () => {
    ok([a()]);
    const r = host([b()], { REFUSE: '1' });
    assert.notEqual(r.status, 0);
    assert.match(r.out, new RegExp(`would not start[\\s\\S]*left running on releases/${a()}`));
    assert.doesNotMatch(r.calls, /systemctl --user restart/);
    assert.equal(link('current'), `releases/${a()}`);
  });

  test("a failed Chromium install says what to set, and the env file's override reaches it", () => {
    const r = host([a()], { OLD_PLAYWRIGHT: '1' });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /does not support this OS[\s\S]*host: playwright could not[\s\S]*ubuntu24\.04-x64/);
    assert.doesNotMatch(r.calls, /systemctl --user restart/);
    const env = path.join(home, '.config', 'folly-studio', 'studio.env');
    writeFileSync(env, `${readFileSync(env, 'utf8')}PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64\n`);
    ok([a()], { OLD_PLAYWRIGHT: '1' });
  });

  test('--rollback switches to the previous release without building, and back again', () => {
    ok([a()]);
    ok([b()]);
    let r = ok(['--rollback']);
    assert.doesNotMatch(r.calls, /npm/);
    assert.match(r.calls, /systemctl --user restart/);
    assert.deepEqual([link('current'), link('previous')], [`releases/${a()}`, `releases/${b()}`]);
    r = ok(['--rollback']);
    assert.deepEqual([link('current'), link('previous')], [`releases/${b()}`, `releases/${a()}`]);
  });

  test('deploying the live commit again builds nothing', () => {
    ok([a()]);
    const r = ok([a()]);
    assert.doesNotMatch(r.calls, /npm/);
    assert.match(r.calls, /config-check[\s\S]*systemctl --user restart/);
  });

  test('keeps three releases: current, previous and the newest other', () => {
    for (const commit of [a, b, c, d]) ok([commit()]);
    assert.deepEqual(readdirSync(path.join(checkout, 'releases')).sort(), [b(), c(), d()].sort());
    assert.deepEqual([link('current'), link('previous')], [`releases/${d()}`, `releases/${c()}`]);
    assert.doesNotMatch(git(checkout, 'worktree', 'list'), new RegExp(a()));
  });

  test('a checkout another instance serves, a deploy under way, an old commit or no previous release stops it', () => {
    assert.match(host(['--rollback']).out, /no previous release/);
    assert.match(host([before]).out, /predates releases/);
    assert.ok(!existsSync(path.join(checkout, 'releases')));
    const locked = host([a()], {}, ['flock', path.join(checkout, '.host.lock')]);
    assert.match(locked.out, /another npm run host is deploying/);
    const units = path.join(home, '.config', 'systemd', 'user');
    mkdirSync(units, { recursive: true });
    for (const dir of [`${checkout}/current`, checkout]) { // a release-based unit, and one from before releases
      writeFileSync(path.join(units, 'folly-studio-dev.service'), `WorkingDirectory=${dir}\n`);
      assert.match(host([a()]).out, /is folly-studio-dev's checkout/);
    }
  });
});
