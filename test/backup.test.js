// tools/backup.ts: a dated .tar.gz of the data dir, JSON files consistent while they are being rewritten,
// baked frames only when asked, written atomically; and real tar reads it. deploy/backup.sh, the daily timer's: older
// archives pruned, the new one copied off-site (a stand-in rsync), and a failure is the unit's.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { afterAll, test } from 'vitest';

import { createStore } from '../src/store.ts';
import { backup, prune, snapshot } from '../tools/backup.ts';

const SCRIPT = fileURLToPath(new URL('../deploy/backup.sh', import.meta.url));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-backup-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A .tar.gz's regular files: { name: Buffer }. */
function untar(file) {
  const tar = zlib.gunzipSync(fs.readFileSync(file));
  const out = {};
  for (let at = 0; at + 512 <= tar.length;) {
    const head = tar.subarray(at, at + 512);
    if (head.every((b) => b === 0)) break;
    const name = head.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(head.subarray(124, 136).toString('utf8'), 8);
    let sum = 0;
    head.forEach((b, i) => { sum += i >= 148 && i < 156 ? 32 : b; });
    assert.equal(parseInt(head.subarray(148, 156).toString('utf8'), 8), sum, `${name} checksum`);
    out[name] = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

test('a dated archive of the JSON files; frames only with --frames, never the wire folders', async () => {
  const data = path.join(tmp, 'data');
  const store = await createStore(data);
  store.users.create({ username: 'ana' });
  store.looks.create({ title: 'Reef', layers: [] });
  await store.flush();
  fs.mkdirSync(path.join(data, 'frames', 'ab'.repeat(16)), { recursive: true });
  fs.writeFileSync(path.join(data, 'frames', 'look1.fseq'), Buffer.alloc(3000, 7));
  fs.writeFileSync(path.join(data, 'frames', 'ab'.repeat(16), '0.br'), 'chunk');
  const now = new Date('2026-10-17T21:30:05.123Z');
  const plain = await backup({ dataDir: data, now });
  assert.equal(plain.file, path.join(tmp, 'data-backups', 'folly-studio-2026-10-17T21-30-05Z.tar.gz'));
  const files = untar(plain.file);
  assert.equal(plain.entries, 2);
  const root = 'folly-studio-2026-10-17T21-30-05Z';
  assert.deepEqual(Object.keys(files).sort(), ['looks', 'users'].map((n) => `${root}/${n}.json`));
  assert.equal(JSON.parse(files[`${root}/looks.json`])[0].title, 'Reef');
  assert.equal(fs.statSync(plain.file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.join(tmp, 'data-backups')), [path.basename(plain.file)], 'no temporary left');

  const full = await backup({ dataDir: data, outDir: path.join(tmp, 'full'), frames: true, now });
  const all = untar(full.file);
  assert.equal(full.entries, 3, 'what went in, not the wire folder');
  assert.deepEqual(all[`${root}/frames/look1.fseq`], Buffer.alloc(3000, 7));
  assert.ok(!Object.keys(all).some((n) => n.endsWith('.br')));
  let listing = null;
  try { listing = execFileSync('tar', ['-tzf', full.file], { encoding: 'utf8' }); } catch { /* no tar here */ }
  if (listing !== null) assert.match(listing, /frames\/look1\.fseq/);
});

test('while the server rewrites its files, the snapshot holds whole files from one moment', async () => {
  const data = path.join(tmp, 'busy');
  const store = await createStore(data);
  for (let i = 0; i < 200; i++) store.users.create({ username: `user ${i}`.repeat(20) });
  store.looks.create({ title: 'first' });
  await store.flush();
  let writing = true, writes = 0;
  // Bursts of rewrites, as a busy server makes, with a short still moment after each: a snapshot must wait for one,
  // and a loop with none would starve it on a loaded machine.
  const churn = (async () => {
    while (writing) {
      for (let burst = 0; burst < 3; burst++) {
        store.users.create({ username: `more ${writes++}` });
        store.looks.create({ title: `look ${writes}` });
        await store.flush();
      }
      await new Promise((r) => setTimeout(r, 40));
    }
  })();
  try {
    for (let i = 0; i < 5; i++) {
      const files = await snapshot(data);
      const users = JSON.parse(files.find((f) => f.name === 'users.json').body);
      const looks = JSON.parse(files.find((f) => f.name === 'looks.json').body);
      assert.ok(users.length >= 200);
      assert.ok(Math.abs(users.length - 200 - (looks.length - 1)) <= 1, 'the two files are from about one moment');
    }
  } finally {
    writing = false;
    await churn;
  }
  assert.ok(writes > 0);
});

test('a file it cannot read fails the backup rather than leave it out', async ({ skip }) => {
  skip(process.getuid?.() === 0, 'root reads any file');
  const data = path.join(tmp, 'locked'), out = path.join(tmp, 'locked-out');
  fs.mkdirSync(path.join(data, 'frames'), { recursive: true });
  fs.writeFileSync(path.join(data, 'users.json'), '[]\n');
  fs.writeFileSync(path.join(data, 'frames', 'a.fseq'), 'x');
  fs.chmodSync(path.join(data, 'frames', 'a.fseq'), 0);
  await assert.rejects(backup({ dataDir: data, outDir: out, frames: true }), { code: 'EACCES' });
  assert.deepEqual(fs.readdirSync(out), [], 'no archive, no temporary');
  assert.equal((await backup({ dataDir: data, outDir: out })).entries, 1, 'without frames it never opens them');
  fs.chmodSync(path.join(data, 'users.json'), 0);
  await assert.rejects(snapshot(data), { code: 'EACCES' });
});

test('the daily backup keeps the newest archives, copies the new one off-site, and fails loudly', async ({ skip }) => {
  const data = path.join(tmp, 'daily'), out = path.join(tmp, 'daily-backups'), bin = path.join(tmp, 'daily-bin');
  const log = path.join(tmp, 'rsync.log');
  fs.mkdirSync(data);
  fs.mkdirSync(out);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(data, 'users.json'), '[]\n');
  const old = ['01', '02', '03'].map((d) => `folly-studio-2026-01-${d}T04-15-00Z.tar.gz`);
  for (const name of [...old, 'notes.txt']) fs.writeFileSync(path.join(out, name), 'x');
  fs.writeFileSync(path.join(bin, 'rsync'), `#!/bin/sh\necho "$*" >> "${log}"\n`, { mode: 0o755 });
  const run = (env) => spawnSync('bash', [SCRIPT], { encoding: 'utf8', timeout: 30_000, env: { ...process.env,
    PATH: `${bin}:${process.env.PATH}`, STUDIO_DATA: data, STUDIO_BACKUP_DIR: out, STUDIO_BACKUP_KEEP: '2', ...env } });
  const r = run({ STUDIO_BACKUP_OFFSITE: 'me@far:folly/' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const made = fs.readdirSync(out).filter((n) => n.endsWith('.tar.gz') && !old.includes(n));
  assert.equal(made.length, 1);
  assert.deepEqual(fs.readdirSync(out).sort(), [old[2], made[0], 'notes.txt'].sort(),
    'the newest two, and nothing else');
  assert.match(r.stdout, new RegExp(`removed ${old[0]}\nremoved ${old[1]}\n[\\s\\S]*copied to me@far:folly/`));
  assert.match(fs.readFileSync(log, 'utf8'), new RegExp(` -- ${out}/${made[0]} me@far:folly/\n$`));

  assert.equal(run({ STUDIO_BACKUP_KEEP: '0' }).status, 1, 'a bad count writes nothing');
  assert.equal(fs.readdirSync(out).length, 3);
  await assert.rejects(prune(out, 1.5), /a whole number/);
  skip(process.getuid?.() === 0, 'root reads any file');
  fs.writeFileSync(log, '');
  fs.chmodSync(path.join(data, 'users.json'), 0);
  const failed = run({ STUDIO_BACKUP_OFFSITE: 'me@far:folly' });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /EACCES/);
  assert.equal(fs.readFileSync(log, 'utf8'), '', 'nothing copied');
});
