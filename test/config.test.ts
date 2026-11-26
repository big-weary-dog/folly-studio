// The server's settings (src/config.ts): each read once, a bad one refused by name and never by value, units on
// durations and sizes, warnings for a likely mistake, and config:check.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, test } from 'vitest';

import { ConfigError, describeConfig, readConfig } from '../src/config.ts';
import { fx, useFixture } from './fixtures/server.js';

useFixture();
const quiet = (env: Record<string, string>) => {
  const said: string[] = [], warned: string[] = [];
  const config = readConfig(env, { log: { warn: (m: unknown) => said.push(String(m)) }, warned });
  return { config, said, warned };
};

describe('settings', () => {
  test('on/off takes either word; anything else is refused', () => {
    for (const v of ['1', 'true', 'TRUE', 'on', 'On', 'yes', ' YES ']) {
      assert.equal(readConfig({ STUDIO_FLASH_CHECK: v }).STUDIO_FLASH_CHECK, true, v);
    }
    for (const v of ['0', 'false', 'off', 'No']) {
      assert.equal(readConfig({ STUDIO_FLASH_CHECK: v }).STUDIO_FLASH_CHECK, false, v);
    }
    assert.equal(readConfig({ STUDIO_FLASH_CHECK: '' }).STUDIO_FLASH_CHECK, undefined);
    assert.throws(() => readConfig({ STUDIO_FLASH_CHECK: 'enabled' }),
      (e) => e instanceof ConfigError && e.message.startsWith('STUDIO_FLASH_CHECK must be on or off'));
  });

  test('durations and sizes take units; a bare duration is in seconds', () => {
    const at = (v: string) => readConfig({ STUDIO_BAKE_TIMEOUT: v }).STUDIO_BAKE_TIMEOUT;
    assert.deepEqual(['90', '250ms', '30m', '2h'].map(at), [90_000, 250, 1_800_000, 7_200_000]);
    const c = readConfig({ STUDIO_FRAMES_MAX_BYTES: '2GB', STUDIO_BAKE_MEMORY: '512k',
      STUDIO_BAKE_MAX_FRAMES: '1048576' });
    assert.equal(c.STUDIO_FRAMES_MAX_BYTES, 2 * 1024 ** 3);
    assert.equal(c.STUDIO_BAKE_MEMORY, 512 * 1024);
    assert.equal(c.STUDIO_BAKE_MAX_FRAMES, 1_048_576);
  });

  test('every bad setting is named, never its value', () => {
    const env = { PORT: 'eighty', STUDIO_FRAMES_BROTLI_QUALITY: '12', STUDIO_PREVIEWS: 'all',
      STUDIO_BAKE_TIMEOUT: 'soon', STUDIO_BAKE_MEMORY: 'lots' };
    let err: unknown;
    try { readConfig(env); } catch (e) { err = e; }
    assert.ok(err instanceof ConfigError);
    assert.deepEqual(err.names, ['PORT', 'STUDIO_FRAMES_BROTLI_QUALITY', 'STUDIO_PREVIEWS', 'STUDIO_BAKE_TIMEOUT',
      'STUDIO_BAKE_MEMORY']);
    for (const v of ['eighty', '12', 'all', 'soon', 'lots']) assert.ok(!err.message.includes(v), v);
  });

  test('a STUDIO_ name nothing reads is warned of; the deploy script\'s are not', () => {
    const { said, warned } = quiet({ STUDIO_FLASH_CHEK: 'off', STUDIO_REF: 'main', HOME: '/home/you' });
    assert.deepEqual(warned, ['STUDIO_FLASH_CHEK']);
    assert.match(said[0]!, /STUDIO_FLASH_CHEK is not a setting/);
  });

  test('the start-up line shows what is set', () => {
    assert.equal(describeConfig(readConfig({ PORT: '8780' })), 'PORT=8780; the rest at their defaults');
  });
});

describe('npm run config:check', () => {
  const check = (text: string) => {
    const file = path.join((fx as { tmp: string }).tmp, `check-${Math.random().toString(36).slice(2)}.env`);
    writeFileSync(file, text);
    try {
      return { code: 0, out: execFileSync(process.execPath, ['tools/config-check.ts', file], { encoding: 'utf8' }) };
    } catch (err) {
      const e = err as { status: number, stdout: string };
      return { code: e.status, out: e.stdout };
    }
  };

  test('OK, or the names alone; exit 1 when the server would not start', () => {
    assert.deepEqual(check('# the settings\nPORT=8780\nSTUDIO_SECURE_COOKIES=1\nSTUDIO_REF=origin/main\n'),
      { code: 0, out: 'OK\n' });
    const bad = check('PORT=eighty\nSTUDIO_FLASH_CHECK=maybe\n');
    assert.deepEqual(bad, { code: 1, out: 'would not start; fix: PORT STUDIO_FLASH_CHECK\n' });
    assert.deepEqual(check('STUDIO_TYPO=1\n'), { code: 0, out: 'OK\nwarned of: STUDIO_TYPO\n' });
  });
});
