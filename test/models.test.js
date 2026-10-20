// The model registry (src/generate/models.ts): its file made with the defaults, checked, read again when it changes,
// what each transport needs to run, what each role may pick; and finding the codex command (src/generate/proc.ts).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { describe, test } from 'vitest';

import { createRegistry, DEFAULT_MODELS } from '../src/generate/models.ts';
import { findExecutable, shimTarget } from '../src/generate/proc.ts';
import { FIX, quiet, tmp } from './fixtures/generate/shared.js';

const BIN = path.join(FIX, 'bin');
const registry = (dir, o = {}) => createRegistry({ file: path.join(dir, 'models.json'), env: {}, log: quiet, ...o });
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'models.json'), 'utf8'));
const later = (file) => { const t = new Date(Date.now() + 5000); fs.utimesSync(file, t, t); };

describe('the registry file', () => {
  test('first run writes the defaults: Opus (the default), Sol, Luna and Sketch', () => {
    const dir = tmp('models'), r = registry(dir);
    assert.deepEqual(read(dir), DEFAULT_MODELS);
    assert.deepEqual(r.config().models.map((m) => m.critique), [undefined, 'images', 'text', undefined]);
    assert.deepEqual(r.config().models.map((m) => [m.id, m.via, m.model]), [['opus', 'claude', 'claude-opus-5-5'],
      ['sol', 'codex', 'gpt-6.1-sol'], ['luna', 'codex', 'gpt-6-luna'], ['sketch', 'sketch', undefined]]);
    assert.equal(r.defaultId(), 'opus');
    assert.deepEqual([r.limit('claude'), r.limit('codex'), r.limit('sketch')], [4, 2, undefined]);
  });

  test('STUDIO_GENERATOR names the first default; once the file exists, the file wins', () => {
    assert.equal(registry(tmp('legacy'), { legacy: 'sketch' }).defaultId(), 'sketch');
    const dir = tmp('legacy-fleet'), fleet = registry(dir, { legacy: 'fleet' });
    assert.equal(fleet.defaultId(), 'foundry');
    assert.equal(fleet.get('foundry').via, 'fleet');
    const infos = [];
    assert.equal(registry(dir, { legacy: 'claude', log: { ...quiet, info: (m) => infos.push(m) } }).defaultId(),
      'foundry');
    assert.match(infos.join('\n'), /STUDIO_GENERATOR is superseded/);
  });

  test('an edit applies without a restart; a broken one is reported and the last good kept', () => {
    const dir = tmp('reload'), r = registry(dir), file = path.join(dir, 'models.json');
    const next = read(dir);
    next.default = 'luna';
    next.models.find((m) => m.id === 'sol').enabled = false;
    fs.writeFileSync(file, JSON.stringify(next));
    later(file);
    assert.equal(r.defaultId(), 'luna');
    assert.equal(r.get('sol').enabled, false);
    fs.writeFileSync(file, '{ "default": "luna", ');
    later(file);
    assert.equal(r.defaultId(), 'luna');
    assert.match(r.admin().problem, /models\.json is not valid JSON/);
    const x = { id: 'x', label: 'X', via: 'codex' };
    fs.writeFileSync(file, JSON.stringify({ ...next, models: [...next.models, x] }));
    later(file);
    assert.match(r.admin().problem, /^models\.json: Model 5 \(x\): a codex model needs its model name\.$/);
    fs.writeFileSync(file, JSON.stringify(next));
    later(file);
    assert.equal(r.admin().problem, undefined);
  });

  test('save checks the shape, names the first problem, and writes the file', () => {
    const dir = tmp('save'), r = registry(dir), good = read(dir);
    const bad = (change, why) => {
      const c = structuredClone(good);
      change(c);
      assert.deepEqual(r.save(c), { error: why });
    };
    bad((c) => { c.models[0].effort = 'minimal'; }, 'Model 1 (opus): effort must be one of low, medium, high, xhigh, '
      + 'max for claude.');
    bad((c) => { c.models[1].effort = 'max'; }, 'Model 2 (sol): effort must be one of minimal, low, medium, high, '
      + 'xhigh for codex.');
    bad((c) => { c.models[3].id = 'opus'; }, 'Model 4 (opus): id opus is used twice.');
    bad((c) => { c.default = 'gpt'; }, 'default must name a model.');
    bad((c) => { c.models[1].model = '--dangerously-bypass-approvals-and-sandbox'; },
      'Model 2 (sol): model must be a model name: letters, digits, . _ : / or -.');
    bad((c) => { c.models[0].secret = 1; }, 'Model 1 (opus): Unrecognized key: "secret"');
    bad((c) => { c.concurrency.codex = 99; }, 'concurrency.codex must be at most 16.');
    bad((c) => { c.models = []; }, 'models must list at least one model.');
    bad((c) => { c.models[3].critique = 'images'; }, 'Model 4 (sketch): sketch takes no critique.');
    bad((c) => { c.models[1].critique = 'video'; }, 'Model 2 (sol): critique must be images or text.');
    const next = { ...good, default: 'sketch', concurrency: { codex: 1 } };
    const saved = r.save(next);
    assert.equal(saved.config.default, 'sketch');
    assert.deepEqual(read(dir), next);
    assert.equal(r.limit('codex'), 1);
    assert.deepEqual(fs.readdirSync(dir), ['models.json'], 'no temporary file left');
  });
});

describe('availability and choices', () => {
  test('each transport says what it needs: a key, the CLI on PATH, the foundry on', () => {
    const none = registry(tmp('none'));
    const states = Object.fromEntries(none.admin().models.map((s) => [s.id, s]));
    assert.deepEqual(states.opus, { id: 'opus', available: false, note: 'ANTHROPIC_API_KEY is not set.' });
    assert.deepEqual(states.sol, { id: 'sol', available: false, note: 'codex is not on PATH.' });
    assert.equal(states.sketch.available, true);
    const home = tmp('codex-home');
    const env = { ANTHROPIC_API_KEY: 'k', PATH: BIN, CODEX_HOME: home };
    const all = registry(tmp('all'), { env });
    const by = () => Object.fromEntries(all.admin().models.map((s) => [s.id, s]));
    assert.equal(by().opus.available, true);
    assert.deepEqual(by().luna, { id: 'luna', available: true, warn: true,
      note: 'Codex CLI found; no login seen (run codex login).' });
    fs.writeFileSync(path.join(home, 'auth.json'), '{}');
    const signedIn = registry(tmp('signed'), { env });
    assert.equal(signedIn.admin().models.find((s) => s.id === 'luna').note, 'Codex CLI found, signed in.');
    const foundry = { id: 'deep', label: 'Deep', via: 'fleet', enabled: true };
    const off = registry(tmp('fleet'));
    assert.equal(off.save({ ...DEFAULT_MODELS, models: [...DEFAULT_MODELS.models, foundry] }).models
      .find((s) => s.id === 'deep').available, false);
  });

  test('a user picks among models that are on, offered to their role and able to run', () => {
    const dir = tmp('choices');
    const r = registry(dir, { env: { PATH: BIN } });
    const c = read(dir);
    c.models.find((m) => m.id === 'luna').roles = ['admin'];
    c.models.find((m) => m.id === 'sketch').enabled = false;
    r.save(c);
    assert.deepEqual(r.choices('member'), { models: [{ id: 'sol', label: 'Sol', paid: true }], default: 'sol' },
      'opus has no key, luna is for admins, sketch is off');
    assert.deepEqual(r.choices('admin').models.map((m) => m.id), ['sol', 'luna']);
    assert.equal(r.pick(undefined, 'member').entry.id, 'sol');
    assert.equal(r.pick('luna', 'admin').entry.id, 'luna');
    assert.deepEqual(r.pick('luna', 'member'), { error: 'Luna is not offered to your account.' });
    assert.deepEqual(r.pick('sketch', 'admin'), { error: 'Sketch is turned off.' });
    assert.deepEqual(r.pick('opus', 'admin'), { error: 'Opus is not set up on this server right now.' });
    assert.deepEqual(r.pick('gpt-9', 'admin'), { error: 'There is no model called "gpt-9".' });
    c.models.forEach((m) => { m.enabled = false; });
    r.save(c);
    assert.deepEqual(r.choices('member'), { models: [], default: null });
    assert.deepEqual(r.pick(undefined, 'member'), { error: 'No model is available right now.' });
  });
});

describe('finding the codex command', () => {
  test('on PATH, by a path, or not at all', () => {
    assert.deepEqual(findExecutable('codex', { env: { PATH: `/nowhere:${BIN}` } }),
      { cmd: path.join(BIN, 'codex'), args: [] });
    assert.deepEqual(findExecutable(path.join(BIN, 'codex'), { env: {} }), { cmd: path.join(BIN, 'codex'), args: [] });
    assert.equal(findExecutable('codex', { env: { PATH: '/nowhere' } }), null);
    assert.equal(findExecutable('codex', { env: {} }), null);
  });

  test("on Windows, npm's codex.cmd shim becomes node and the script it runs: no cmd.exe", () => {
    const shim = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\n'
      + 'CALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n'
      + '  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || '
      + 'title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n';
    assert.equal(shimTarget(shim), 'node_modules\\@openai\\codex\\bin\\codex.js');
    assert.equal(shimTarget('@echo off\r\ncodex-real.exe %*'), null);
    // The lookup itself, as Windows does it (PATHEXT, the Path key's case), on this machine's files.
    const dir = tmp('npm-global'), script = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(path.join(dir, 'codex.cmd'), shim, { mode: 0o755 });
    fs.writeFileSync(script, '', { mode: 0o755 });
    const found = findExecutable('codex', { env: { Path: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, platform: 'win32' });
    assert.deepEqual(found, { cmd: process.execPath, args: [script] });
  });
});
