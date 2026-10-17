// tools/backup.mjs: a dated .tar.gz of the data dir, JSON files consistent while they are being rewritten,
// baked frames only when asked, written atomically; and real tar reads it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import zlib from 'node:zlib';

import { createStore } from '../src/store.js';
import { backup, snapshot } from '../tools/backup.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-backup-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

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
  assert.equal(plain.file, path.join(tmp, 'backups', 'folly-studio-2026-10-17T21-30-05Z.tar.gz'));
  const files = untar(plain.file);
  const root = 'folly-studio-2026-10-17T21-30-05Z';
  assert.deepEqual(Object.keys(files).sort(), ['looks', 'users'].map((n) => `${root}/${n}.json`));
  assert.equal(JSON.parse(files[`${root}/looks.json`])[0].title, 'Reef');
  assert.equal(fs.statSync(plain.file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.join(tmp, 'backups')), [path.basename(plain.file)], 'no temporary left');

  const full = await backup({ dataDir: data, outDir: path.join(tmp, 'full'), frames: true, now });
  const all = untar(full.file);
  assert.deepEqual(all[`${root}/frames/look1.fseq`], Buffer.alloc(3000, 7));
  assert.ok(!Object.keys(all).some((n) => n.endsWith('.br')));
  let listing = null;
  try { listing = execFileSync('tar', ['-tzf', full.file], { encoding: 'utf8' }); } catch { /* no tar here */ }
  if (listing !== null) assert.match(listing, /frames\/look1\.fseq/);
});

test('while the server rewrites its files, the snapshot holds whole files from one moment', async () => {
  const data = path.join(tmp, 'busy');
  const store = await createStore(data);
  for (let i = 0; i < 200; i++) store.ideas.create({ text: `idea ${i}`.repeat(20) });
  store.looks.create({ title: 'first' });
  await store.flush();
  let writing = true, writes = 0;
  const churn = (async () => {
    while (writing) {
      store.ideas.create({ text: `more ${writes++}` });
      store.looks.create({ title: `look ${writes}` });
      await store.flush();
    }
  })();
  try {
    for (let i = 0; i < 5; i++) {
      const files = await snapshot(data);
      const ideas = JSON.parse(files.find((f) => f.name === 'ideas.json').body);
      const looks = JSON.parse(files.find((f) => f.name === 'looks.json').body);
      assert.ok(ideas.length >= 200);
      assert.ok(Math.abs(ideas.length - 200 - (looks.length - 1)) <= 1, 'the two files are from about one moment');
    }
  } finally {
    writing = false;
    await churn;
  }
  assert.ok(writes > 0);
});
