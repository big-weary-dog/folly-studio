// Loopback-only output: a failed start never lights a frame; crashes and signals end with black.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import { ddpReceiver } from '../src/ddp.ts';

const main = fileURLToPath(new URL('../main.ts', import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), 'pi-startup-'));
const config = path.join(dir, 'config.json');
writeFileSync(config, '{}');

async function run(args: string[], preload?: string, signal?: NodeJS.Signals) {
  const frames: boolean[] = [];
  const receiver = ddpReceiver({ port: 0, channels: 70401, onFrame: (f) => frames.push(f.some((v) => v !== 0)) });
  const port = await receiver.ready;
  const child = spawn(process.execPath, [...preload ? ['--import', preload] : [], main,
    '--config', config, '--host', '127.0.0.1', '--port', String(port), '--http', '0', '--mode', 'live',
    '--seconds', '10', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  const exited = once(child, 'exit');
  child.stdout.on('data', (d) => {
    out += String(d);
    if (signal && /playing heartbeat-plasma/.test(out)) { child.kill(signal); signal = undefined; }
  });
  child.stderr.on('data', (d) => { err += String(d); });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 20_000);
  try {
    const [code] = await exited;
    return { code, out, err, frames };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await receiver.close();
  }
}

test('an occupied control port fails before any output is sent', async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const r = await run(['--http', String(address.port), '--bind', '127.0.0.1']);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out + r.err, /EADDRINUSE/);
    assert.deepEqual(r.frames, []);
  } finally { await new Promise<void>((r) => server.close(() => r())); }
});

test('a malformed local safe override stops startup before output', async () => {
  writeFileSync(path.join(dir, 'safe.json'), JSON.stringify({
    layers: [{ modules: [{ ref: 'clouds' }], groups: 42 }],
  }));
  const r = await run(['--looks', dir]);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /the safe look safe cannot play/);
  assert.deepEqual(r.frames, []);
});

test.each(['throw new Error("injected crash")', 'void Promise.reject(new Error("injected rejection"))'])(
  'a failure after output starts sends black: %s', async (failure) => {
    const preload = path.join(dir, `${failure.includes('reject') ? 'reject' : 'crash'}.mjs`);
    writeFileSync(preload, `const log = console.log;
console.log = (...args) => {
  log(...args);
  if (String(args[0]).includes('playing heartbeat-plasma')) setTimeout(() => { ${failure}; }, 300);
};\n`);
    const r = await run([], preload);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out + r.err, /injected/);
    assert.ok(r.frames.some(Boolean), 'played lit frames before the failure');
    assert.equal(r.frames.at(-1), false, 'the receiver holds black after the failure');
  });

test.each(['SIGINT', 'SIGTERM'] as const)('%s fades and sends black before exit', async (signal) => {
  const r = await run([], undefined, signal);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, new RegExp(`${signal}: fading to black`));
  assert.ok(r.frames.some(Boolean));
  assert.equal(r.frames.at(-1), false, 'the receiver holds black after shutdown');
});
