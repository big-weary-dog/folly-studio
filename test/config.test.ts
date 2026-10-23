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
      assert.equal(readConfig({ STUDIO_FOUNDRY: v }).STUDIO_FOUNDRY, true, v);
    }
    for (const v of ['0', 'false', 'off', 'No']) {
      assert.equal(readConfig({ STUDIO_FOUNDRY: v }).STUDIO_FOUNDRY, false, v);
    }
    assert.equal(readConfig({ STUDIO_FOUNDRY: '' }).STUDIO_FOUNDRY, undefined);
    assert.throws(() => readConfig({ STUDIO_FOUNDRY: 'enabled' }),
      (e) => e instanceof ConfigError && e.message.startsWith('STUDIO_FOUNDRY must be on or off'));
  });

  test('durations and sizes take units; a bare number is in the name\'s unit', () => {
    const c = readConfig({ STUDIO_FLEET_TIMEOUT: '90', STUDIO_FLEET_POLL: '250ms', STUDIO_BAKE_TIMEOUT: '30m',
      STUDIO_CODEX_TIMEOUT_MS: '300000', STUDIO_CLAUDE_TIMEOUT_MS: '5m', STUDIO_CRITIQUE_BUDGET_MS: '2h',
      STUDIO_FRAMES_MAX_BYTES: '2GB', STUDIO_BAKE_MEMORY: '512k', STUDIO_IDEA_LOGS_MAX_BYTES: '1048576' });
    assert.equal(c.STUDIO_FLEET_TIMEOUT, 90_000);
    assert.equal(c.STUDIO_FLEET_POLL, 250);
    assert.equal(c.STUDIO_BAKE_TIMEOUT, 1_800_000);
    assert.equal(c.STUDIO_CODEX_TIMEOUT_MS, 300_000);
    assert.equal(c.STUDIO_CLAUDE_TIMEOUT_MS, 300_000);
    assert.equal(c.STUDIO_CRITIQUE_BUDGET_MS, 7_200_000);
    assert.equal(c.STUDIO_FRAMES_MAX_BYTES, 2 * 1024 ** 3);
    assert.equal(c.STUDIO_BAKE_MEMORY, 512 * 1024);
    assert.equal(c.STUDIO_IDEA_LOGS_MAX_BYTES, 1_048_576);
  });

  test('every bad setting is named, never its value', () => {
    const env = { PORT: 'eighty', STUDIO_FRAMES_BROTLI_QUALITY: '12', STUDIO_LIVE_LOOKS: 'all',
      STUDIO_FLEET_TIMEOUT: 'soon', STUDIO_BAKE_MEMORY: 'lots', ANTHROPIC_API_KEY: 'sk-ant-secret' };
    let err: unknown;
    try { readConfig(env); } catch (e) { err = e; }
    assert.ok(err instanceof ConfigError);
    assert.deepEqual(err.names, ['PORT', 'STUDIO_FRAMES_BROTLI_QUALITY', 'STUDIO_LIVE_LOOKS', 'STUDIO_BAKE_MEMORY',
      'STUDIO_FLEET_TIMEOUT']);
    for (const v of ['eighty', '12', 'all', 'soon', 'lots', 'sk-ant']) assert.ok(!err.message.includes(v), v);
  });

  test('a likely mistake is warned of: a bare _MS value under a second, a STUDIO_ name nothing reads', () => {
    const { said, warned } = quiet({ STUDIO_CODEX_IDLE_MS: '180', STUDIO_FLASH_CHEK: 'off', STUDIO_REF: 'main',
      STUDIO_CLAUDE_TIMEOUT_MS: '300000', HOME: '/home/you' });
    assert.deepEqual(warned, ['STUDIO_CODEX_IDLE_MS', 'STUDIO_FLASH_CHEK']);
    assert.match(said[0]!, /STUDIO_CODEX_IDLE_MS=180 is 180 ms; for seconds, write 180s/);
    assert.match(said[1]!, /STUDIO_FLASH_CHEK is not a setting/);
  });

  test('the start-up line shows what is set, the API key only as set', () => {
    const line = describeConfig(readConfig({ PORT: '8780', ANTHROPIC_API_KEY: 'sk-ant-secret' }));
    assert.equal(line, 'PORT=8780 ANTHROPIC_API_KEY=(set); the rest at their defaults');
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
    const bad = check('PORT=eighty\nANTHROPIC_API_KEY="sk-ant-secret"\nSTUDIO_FLASH_CHECK=maybe\n');
    assert.deepEqual(bad, { code: 1, out: 'would not start; fix: PORT STUDIO_FLASH_CHECK\n' });
    assert.deepEqual(check('STUDIO_TYPO=1\nSTUDIO_CODEX_IDLE_MS=180\n'),
      { code: 0, out: 'OK\nwarned of: STUDIO_CODEX_IDLE_MS STUDIO_TYPO\n' });
  });
});
