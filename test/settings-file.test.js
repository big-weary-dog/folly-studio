// src/atomic-file.ts and src/settings-file.ts: writes to one file land whole and in call order, each through its own
// temporary; a settings file reads its defaults when missing or broken, a hand edit on the next read, and the last
// save while saves overlap.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, test } from 'vitest';

import { writeFileAtomic } from '../src/atomic-file.ts';
import { settingsFile } from '../src/settings-file.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-settings-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('overlapping writes land whole, the last one last, with no temporary left', async () => {
  const file = path.join(tmp, 'deep', 'users.json');
  const texts = Array.from({ length: 20 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(50_000 - i) }));
  await Promise.all(texts.map((t) => writeFileAtomic(file, t)));
  assert.equal(fs.readFileSync(file, 'utf8'), texts.at(-1));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['users.json']);
});

test('a failed write rejects, leaves no temporary, and does not stop the next', async () => {
  const dir = path.join(tmp, 'fails'), file = path.join(dir, 'x.json');
  fs.mkdirSync(path.join(file, 'in'), { recursive: true });
  const bad = writeFileAtomic(file, 'no');
  const cleared = bad.then(() => assert.fail('renamed over a folder'), () => fs.rmSync(file, { recursive: true }));
  const next = writeFileAtomic(file, 'yes');
  await cleared;
  await next;
  assert.equal(fs.readFileSync(file, 'utf8'), 'yes');
  assert.deepEqual(fs.readdirSync(dir), ['x.json']);
});

test('a settings file: defaults, saves, hand edits, and overlapping saves', async () => {
  const file = path.join(tmp, 's', 'light.json'), warned = [];
  const parse = (json) => ({ gamma: typeof json?.gamma === 'number' ? json.gamma : 2 });
  const s = settingsFile({ file, parse, broken: 'using the defaults', log: { warn: (m) => warned.push(m) } });
  assert.deepEqual(s.current(), { gamma: 2 });
  const saves = [s.save({ gamma: 3 }), s.save({ gamma: 4 })];
  assert.deepEqual(s.current(), { gamma: 4 }, 'the last save, while they run');
  await Promise.all(saves);
  assert.deepEqual(s.current(), { gamma: 4 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { gamma: 4 });
  fs.writeFileSync(file, '{ "gamma": 5 ');
  assert.deepEqual(s.current(), { gamma: 2 });
  assert.match(warned[0], /^light\.json is not valid JSON \(.*\); using the defaults$/);
  fs.writeFileSync(file, '{ "gamma": 5 }');
  assert.deepEqual(s.current(), { gamma: 5 }, 'edited by hand');
});
