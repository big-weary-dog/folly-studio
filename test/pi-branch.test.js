// deploy/pi-branch.sh: the `pi` branch is the ref plus one commit adding dist/ and dist/build.json, pushed over any
// older one; this checkout is left as it was. npm is a stand-in that writes a build, so no install runs.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, test } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../deploy/pi-branch.sh', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

describe('npm run pi:branch', () => {
  let dir, origin, clone, bin, prod;
  const run = (...args) => spawnSync('bash', [path.join(clone, 'deploy', 'pi-branch.sh'), ...args], {
    cwd: clone, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', TMPDIR: dir } });

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pi-branch-'));
    origin = path.join(dir, 'origin.git');
    clone = path.join(dir, 'clone');
    bin = path.join(dir, 'bin');
    mkdirSync(bin);
    // `npm run build` makes a dist/; anything else (npm ci) does nothing.
    writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\n[ "$1 $3" = "run build" ] || exit 0\n'
      + 'mkdir -p dist/assets && echo app > dist/index.html && echo js > dist/assets/a.js\n');
    chmodSync(path.join(bin, 'npm'), 0o755);
    git(dir, 'init', '--quiet', '--bare', origin);
    git(dir, 'init', '--quiet', '-b', 'prod', clone);
    mkdirSync(path.join(clone, 'deploy'));
    execFileSync('cp', [SCRIPT, path.join(clone, 'deploy')]);
    writeFileSync(path.join(clone, '.gitignore'), '/dist/\n');
    writeFileSync(path.join(clone, 'server.ts'), '// the server\n');
    git(clone, 'add', '.');
    git(clone, ...ID, 'commit', '--quiet', '-m', 'prod');
    git(clone, 'remote', 'add', 'origin', origin);
    git(clone, 'push', '--quiet', 'origin', 'prod');
    prod = git(clone, 'rev-parse', 'HEAD');
  });

  test('pushes prod plus one commit of dist/ with build.json, twice over', () => {
    for (let i = 0; i < 2; i++) {
      const r = run();
      assert.equal(r.status, 0, r.stderr);
      const pi = git(origin, 'rev-parse', 'pi');
      assert.equal(git(origin, 'rev-parse', 'pi^'), prod, 'one commit on prod');
      assert.deepEqual(git(origin, 'diff', '--name-only', prod, pi).split('\n').sort(),
        ['dist/assets/a.js', 'dist/build.json', 'dist/index.html']);
      assert.equal(JSON.parse(git(origin, 'show', 'pi:dist/build.json')).commit, prod);
    }
    assert.equal(git(clone, 'status', '--porcelain'), '', 'the checkout is as it was');
    assert.equal(git(clone, 'worktree', 'list').split('\n').length, 1, 'no worktree left');
  });

  test('--no-push makes the commit and pushes nothing', () => {
    const before = git(origin, 'rev-parse', 'pi');
    writeFileSync(path.join(clone, 'server.ts'), '// the server, newer\n');
    git(clone, ...ID, 'commit', '--quiet', '-am', 'newer');
    git(clone, 'push', '--quiet', 'origin', 'prod');
    const r = run('--no-push');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /made [0-9a-f]{40} \(not pushed\)/);
    assert.equal(git(origin, 'rev-parse', 'pi'), before);
  });

  test('a ref that is not there stops it', () => {
    const r = run('origin/nowhere');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no origin\/nowhere/);
  });
});
