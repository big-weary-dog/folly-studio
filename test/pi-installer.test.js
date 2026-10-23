// Exercise the real installer in scratch homes with a tiny offline engine; never touch systemd or lights.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, test } from 'vitest';

const installer = path.resolve('pi/install.sh'), scratch = [];
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
afterEach(() => { for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture({ dryFail = false, studioFail = false, helloFail = false, bindFail = false,
  engineExit = null, studioExit = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-'));
  scratch.push(dir);
  const tree = path.join(dir, 'bundle/folly-studio'), home = path.join(dir, 'home');
  write(`${tree}/package.json`, '{"type":"module"}');
  write(`${tree}/dist/build.json`, '{"commit": "123456789abc"}');
  write(`${tree}/pi/main.ts`, `
import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
const httpArg = process.argv[process.argv.indexOf('--http') + 1];
if (!['0', 'auto'].includes(httpArg)) throw new Error('rehearsal must request an ephemeral port');
const port = httpArg === 'auto' ? 0 : Number(httpArg);
if (${dryFail}) process.exit(1);
if (httpArg === '0') console.log('DRY RUN, nothing sent, channels 1-70401 (rose expanded)');
else {
  if (${bindFail}) { console.error('fixture EADDRINUSE'); process.exit(1); }
  if (${engineExit} !== null) fs.writeFileSync(${JSON.stringify(`${dir}/early-pid`)}, String(process.pid));
  const server = http.createServer((_, r) => r.end('<title>Studio Live</title>'));
  new WebSocketServer({ server }).on('connection', (ws, req) => ws.on('message', data => {
    const m = JSON.parse(String(data));
    const originOk = req.headers.origin === 'http://' + req.headers.host;
    ws.send(JSON.stringify({ type: 'hello', ok: !${helloFail} && originOk && m.feed && m.pin === '2468' }));
    if (${engineExit} !== null) ws.on('close', () => {
      console.log('fixture engine early exit');
      process.exit(${engineExit});
    });
  }));
  server.listen(port, '127.0.0.1', () => {
    console.log('control page on http://127.0.0.1:' + server.address().port);
  });
}
`);
  write(`${tree}/tools/config-check.ts`, '');
  write(`${tree}/server.ts`, studioFail ? 'process.exit(1);' : `
import http from 'node:http';
import fs from 'node:fs';
if (!process.env.STUDIO_DATA.includes('.stage-') || process.env.PI_PREVIEW_URL !== '') process.exit(2);
if (process.env.PORT !== '0') throw new Error('Studio rehearsal must request an ephemeral port');
if (${studioExit} !== null) fs.writeFileSync(${JSON.stringify(`${dir}/early-pid`)}, String(process.pid));
const server = http.createServer((_, r) => {
  r.end('Studio', () => {
    if (${studioExit} !== null) {
      console.log('fixture Studio early exit');
      process.exit(${studioExit});
    }
  });
}).listen(Number(process.env.PORT), '127.0.0.1', () => {
  console.log('Folly Studio on http://127.0.0.1:' + server.address().port);
});
`);
  fs.symlinkSync(path.resolve('node_modules'), `${tree}/node_modules`);
  // The installer requires sharp even though this fixture never renders images.
  const tar = spawnSync('tar', ['-czf', `${dir}/bundle.tgz`, '-C', `${dir}/bundle`, 'folly-studio']);
  assert.equal(tar.status, 0, String(tar.stderr));
  write(`${home}/folly-studio/pi/config.json`, '{"pin":"old","keep":true}');
  write(`${home}/folly-studio/pi/local/looks/kept.json`, '{}');
  write(`${home}/folly-studio/old-marker`, 'previous');
  return { dir, home, env: `${home}/.config/folly-studio/studio.env` };
}

function run(f, args = [], extraEnv = {}) {
  return spawnSync('bash', [installer, '--home', f.home, '--bundle', `${f.dir}/bundle.tgz`, '--pin', '2468', ...args],
    { encoding: 'utf8', timeout: 35000, env: { ...process.env, ...extraEnv } });
}

test('staged dry-run failure leaves the active tree and env untouched', () => {
  const f = fixture({ dryFail: true });
  const r = run(f);
  assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(`${f.home}/folly-studio/old-marker`, 'utf8'), 'previous');
  assert.equal(JSON.parse(fs.readFileSync(`${f.home}/folly-studio/pi/config.json`)).pin, 'old');
  assert.ok(!fs.readdirSync(f.home).some(name => name.includes('.stage-') || name.includes('.old-')));
});

test('an engine that fails to bind cannot pass rehearsal', () => {
  const f = fixture({ bindFail: true });
  const r = run(f);
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /fixture EADDRINUSE/);
  assert.doesNotMatch(r.stdout, /authenticated feed hello passed/);
  assert.ok(fs.existsSync(`${f.home}/folly-studio/old-marker`));
});

for (const failure of ['studioFail', 'helloFail']) {
  test(`staged ${failure} keeps the working install and its PIN`, () => {
    const f = fixture({ [failure]: true });
    const original = 'STUDIO_ADMINS=original\nPI_PIN=old\n';
    write(f.env, original);
    const r = run(f);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(`${f.home}/folly-studio/old-marker`));
    assert.equal(fs.readFileSync(f.env, 'utf8'), original);
  });
}

test('a first engine-only install passes the staged checks before activation', () => {
  const f = fixture();
  fs.rmSync(`${f.home}/folly-studio`, { recursive: true });
  const r = run(f);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /authenticated feed hello passed/);
  assert.equal(JSON.parse(fs.readFileSync(`${f.home}/folly-studio/pi/config.json`)).pin, '2468');
  assert.ok(!fs.existsSync(f.env));
});

for (const name of ['engine', 'Studio']) {
  for (const status of [0, 23, 143]) {
    test(`${name} exiting early with status ${status} ${status ? 'fails' : 'passes'} rehearsal`, () => {
      const f = fixture({ [name === 'engine' ? 'engineExit' : 'studioExit']: status });
      // Reap the fixture before the stop signal, making the already-exited race deterministic without a delay.
      write(`${f.dir}/reap.sh`, `
kill() {
  if [ "$#" -eq 1 ] && [ -f '${f.dir}/early-pid' ] && [ "$1" = "$(cat '${f.dir}/early-pid')" ]; then
    wait "$1" 2>/dev/null || true
  fi
  builtin kill "$@"
}
`);
      const r = run(f, name === 'Studio' ? ['--studio', '--admin', 'crew'] : [], { BASH_ENV: `${f.dir}/reap.sh` });
      if (status === 0) {
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.ok(!fs.existsSync(`${f.home}/folly-studio/old-marker`));
      } else {
        assert.notEqual(r.status, 0, r.stdout + r.stderr);
        assert.match(r.stderr, new RegExp(`the staged ${name} exited with status ${status}`));
        assert.match(r.stdout, new RegExp(`fixture ${name} early exit`));
        assert.ok(fs.existsSync(`${f.home}/folly-studio/old-marker`));
      }
    });
  }
}

test('reinstall synchronizes an existing Studio PIN, keeps settings and tests the authenticated feed', () => {
  const f = fixture();
  write(f.env, 'STUDIO_ADMINS=original\nPORT=8780\nPI_PIN=old\n# keep this\n');
  const r = run(f);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /authenticated feed hello passed/);
  const env = fs.readFileSync(f.env, 'utf8');
  assert.match(env, /STUDIO_ADMINS=original/);
  assert.match(env, /# keep this/);
  assert.equal(env.match(/^PI_PIN=/gm).length, 1);
  assert.match(env, /PI_PIN="2468"/);
  assert.equal(JSON.parse(fs.readFileSync(`${f.home}/folly-studio/pi/config.json`)).pin, '2468');
  assert.ok(fs.existsSync(`${f.home}/folly-studio/pi/local/looks/kept.json`));
});

test('a failure after the swap restores the old tree and env', () => {
  const f = fixture();
  const original = 'STUDIO_ADMINS=original\nPI_PIN=old\n';
  write(f.env, original);
  // Fail after copying the staged env: rollback must restore both activated artifacts.
  write(`${f.dir}/bin/cp`, `#!/bin/bash
/usr/bin/cp "$@"
case "$2" in *.stage-*/studio.env) exit 1 ;; esac
`);
  fs.chmodSync(`${f.dir}/bin/cp`, 0o755);
  const r = run(f, [], { PATH: `${f.dir}/bin:${process.env.PATH}` });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /restoring the previous install/);
  assert.equal(fs.readFileSync(`${f.home}/folly-studio/old-marker`, 'utf8'), 'previous');
  assert.equal(fs.readFileSync(f.env, 'utf8'), original);
});

test('Node below 22.18 is rejected before unpacking', () => {
  const f = fixture();
  write(`${f.dir}/bin/node`, `#!/bin/bash
if [ "$1" = -p ]; then echo 22.6.0; else exit 1; fi
`);
  fs.chmodSync(`${f.dir}/bin/node`, 0o755);
  const r = run(f, [], { PATH: `${f.dir}/bin:${process.env.PATH}` });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /needs 22.18 or later/);
  assert.ok(fs.existsSync(`${f.home}/folly-studio/old-marker`));
});
