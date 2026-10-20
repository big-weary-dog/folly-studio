// `npm run pi`: its settings (defaults, then pi/config.json, then flags), and a dry run end to end, as the install
// guide has the person try it first.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, test } from 'vitest';

import { DEFAULTS, readConfig } from '../src/config.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'pi-config-')), none = path.join(dir, 'none.json');
let files = 0;
const file = (cfg: object) => {
  const f = path.join(dir, `${files++}.json`);
  writeFileSync(f, JSON.stringify(cfg));
  return f;
};

describe('settings', () => {
  test('default to live on fppd, stats a minute apart', () => {
    assert.deepEqual(readConfig([], none), { ...DEFAULTS, stats: 60 });
  });

  test('a dry run prints stats every 5 s', () => {
    const c = readConfig(['--dry-run'], none)!;
    assert.equal(c.dryRun, true);
    assert.equal(c.stats, 5);
  });

  test('pi/config.json, then flags over it', () => {
    const f = file({ host: '10.0.0.2', gen: 4000, look: 'fire', dryRun: true });
    const c = readConfig(['--gen', '3000', '--port', '4049'], f)!;
    assert.deepEqual([c.host, c.gen, c.look, c.dryRun, c.port], ['10.0.0.2', 3000, 'fire', true, 4049]);
  });

  test('a bad number, a bad file or an unknown flag stop it, saying why', () => {
    assert.throws(() => readConfig(['--gen', 'lots'], none), /gen must be a number/);
    const bad = path.join(dir, 'bad.json');
    writeFileSync(bad, '{');
    assert.throws(() => readConfig([], bad), /bad\.json/);
    assert.throws(() => readConfig(['--config', none], none), /none\.json/);
    assert.throws(() => readConfig(['--nope'], none), /nope/);
    assert.equal(readConfig(['--base', '/pi'], none)!.base, '/pi');
    for (const b of ['pi', '/pi/', '/../x']) assert.throws(() => readConfig(['--base', b], none), /base must be/);
  });

  test('--help prints the options and runs nothing', () => {
    const logged: string[] = [], log = console.log;
    console.log = (s: string) => logged.push(s);
    try { assert.equal(readConfig(['--help'], none), null); } finally { console.log = log; }
    assert.match(logged[0]!, /--dry-run/);
  });
});

test('a dry run plays, prints its stats and fades out on time', async () => {
  const main = fileURLToPath(new URL('../main.ts', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath,
    [main, '--dry-run', '--http', '0', '--seconds', '2', '--stats', '1', '--config', file({})], { timeout: 20000 });
  const lines = stdout.trim().split('\n');
  assert.match(lines[0]!, /DRY RUN, nothing sent, channels 1-70401 \(rose expanded\), rig .* 2114 px at 40 fps/);
  assert.match(stdout, /playing heartbeat-plasma/);
  assert.match(stdout, /heartbeat-plasma t 1\.\ds \| \d+\.\d fps, render .* \| gen \d+ W/);
  assert.match(stdout, /2 s up: fading to black/);
});

test('live into the simulator: every frame whole, the rose expanded, within the generator', async () => {
  const sim = spawn(process.execPath, [fileURLToPath(new URL('../sim.ts', import.meta.url)), '--port', '0',
    '--png', path.join(dir, 'front.png')], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise((resolve) => sim.on('exit', resolve));
  let out = '';
  sim.stdout.on('data', (d) => { out += d; });
  try {
    for (let i = 0; i < 300 && !/listening for DDP on 127\.0\.0\.1:\d+/.test(out); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const port = /listening for DDP on 127\.0\.0\.1:(\d+)/.exec(out)![1]!;
    const main = fileURLToPath(new URL('../main.ts', import.meta.url));
    await promisify(execFile)(process.execPath, [main, '--port', port, '--http', '0', '--seconds', '2', '--look',
      'fire', '--config', file({})], { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1100));   // a PNG written
  } finally {
    sim.kill('SIGINT');
  }
  assert.equal(await exited, 0, out);
  const done = /pi-sim: done \| (\d+) frames, 0 torn, 0 bad packets \| draw peak \d+ W, 0 frames over/.exec(out);
  assert.ok(done && Number(done[1]) >= 60, out);
  assert.match(out, /\d+ of 2114 px lit/);
  assert.deepEqual([...readFileSync(path.join(dir, 'front.png')).subarray(1, 4)], [0x50, 0x4e, 0x47]);
}, 60000);
