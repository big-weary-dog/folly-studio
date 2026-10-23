// Content polling must see a save made before its first poll, including rename saves and recovery from bad JSON.
import assert from 'node:assert/strict';
import { mkdtempSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { test } from 'vitest';

import { lightReader } from '../src/light-file.ts';

test('a save before the first poll applies; rename, broken contents and recovery keep working', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'pi-light-')), 'light.json');
  writeFileSync(file, '{ "gamma": 2.2 }');
  const read = lightReader(file);
  assert.equal(read()?.gamma, 2.2);
  writeFileSync(file, '{ "gamma": 1 }'); // before any poll, regardless of when a stat worker would run
  assert.equal(read()?.gamma, 1);
  assert.equal(read(), undefined);
  writeFileSync(`${file}.tmp`, '{ "gamma": ');
  renameSync(`${file}.tmp`, file);
  assert.throws(read, /light.json/);
  assert.equal(read(), undefined, 'a broken revision is reported once');
  writeFileSync(`${file}.tmp`, '{ "gamma": 1 }');
  renameSync(`${file}.tmp`, file);
  assert.equal(read()?.gamma, 1, 'recovery to the previous good settings is still a change');
  unlinkSync(file);
  assert.equal(read()?.gamma, 2.2, 'a removed file restores defaults');
  assert.equal(read(), undefined);
  writeFileSync(file, '{');
  assert.throws(lightReader(file), /light.json/, 'a broken file also refuses the initial read');
});
