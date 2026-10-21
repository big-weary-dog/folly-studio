// src/store-lock.ts: one store per data folder; a lock left by a stopped server is taken over.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, test } from 'vitest';

import { createStore } from '../src/store.ts';
import { DataLockedError, LOCK_FILE, lockDataDir } from '../src/store-lock.ts';

const quiet = { error() {} };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-lock-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('a second store on the same folder refuses, naming it; after close() it opens', async () => {
  const dir = path.join(tmp, 'two');
  const first = await createStore(dir, { log: quiet });
  first.looks.create({ title: 'kept', owner: 'u1' });
  assert.equal(fs.readFileSync(path.join(dir, LOCK_FILE), 'utf8').trim(), String(process.pid));
  const second = createStore(dir, { log: quiet });
  await assert.rejects(second, (err) => err instanceof DataLockedError && err.message.includes(dir)
    && err.message.includes(`pid ${process.pid}`));
  await first.close();
  assert.equal(fs.existsSync(path.join(dir, LOCK_FILE)), false);
  const again = await createStore(dir, { log: quiet });
  assert.equal(again.looks.list()[0].title, 'kept');
  await again.close();
});

test('a lock whose pid is not running is taken over', async () => {
  const dir = path.join(tmp, 'stale');
  fs.mkdirSync(dir);
  // A pid above the kernel's pid_max is never running; pid 1 is init (another program's, as after a reboot).
  const init = fs.existsSync('/proc/1/cmdline') && !/node/.test(fs.readFileSync('/proc/1/cmdline', 'latin1'));
  for (const left of ['4194305\n', 'garbage', '', ...(init ? ['1\n'] : [])]) {
    fs.writeFileSync(path.join(dir, LOCK_FILE), left);
    const store = await createStore(dir, { log: quiet });
    assert.equal(fs.readFileSync(path.join(dir, LOCK_FILE), 'utf8').trim(), String(process.pid));
    await store.close();
  }
});

test('servers taking over one stale lock at once: one gets it, the others are refused', async () => {
  const dir = path.join(tmp, 'race');
  fs.mkdirSync(dir);
  for (let round = 0; round < 20; round++) {
    fs.writeFileSync(path.join(dir, LOCK_FILE), '4194305\n');
    const got = await Promise.allSettled(Array.from({ length: 8 }, () => lockDataDir(dir)));
    const won = got.filter((g) => g.status === 'fulfilled');
    assert.equal(won.length, 1, `round ${round}`);
    assert.ok(got.every((g) => g.status === 'fulfilled' || g.reason instanceof DataLockedError));
    assert.deepEqual(fs.readdirSync(dir), [LOCK_FILE], 'no temporaries left');
    await won[0].value.release();
  }
});

test('a takeover cut short leaves a claim the next one passes over', async () => {
  const dir = path.join(tmp, 'claimed');
  fs.mkdirSync(dir);
  const file = path.join(dir, LOCK_FILE);
  fs.writeFileSync(file, '4194305\n');
  fs.writeFileSync(`${file}.${fs.statSync(file).ino}.1`, '4194305\n');
  const lock = await lockDataDir(dir);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), String(process.pid));
  await lock.release();
});

test('a store that fails to load releases the folder', async () => {
  const dir = path.join(tmp, 'corrupt');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'looks.json'), '[{"id": ');
  await assert.rejects(createStore(dir, { log: quiet }), /not valid JSON/);
  assert.equal(fs.existsSync(path.join(dir, LOCK_FILE)), false);
});
