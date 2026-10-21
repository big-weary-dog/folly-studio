// The live chain for the end-to-end run: a static server for show-builder (SHOW_BUILDER_DIR), its relay/relay.js
// (sACN :5568 → WebSocket :3001) and tools/sacn-play.ts, as child processes, stopped together: in the run's process
// group (Ctrl-C reaches them), tagged with their worker (procs.mjs: the sweep kills them if it goes), stopped by
// down() and, failing that, killed as the worker exits.
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import { SHOW_BUILDER } from '../fixtures/sources.js';
import { identity, named, sweep, tagged } from './procs.mjs';

export const REPO = `${SHOW_BUILDER}/`;
export const STUDIO = fileURLToPath(new URL('../../', import.meta.url));
export const RELAY_PORT = 3001;
export const SACN_PORT = 5568;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** True when something accepts TCP connections on 127.0.0.1:port. */
export function listening(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

export async function waitForPort(port, ms = 15000, what = `port ${port}`) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await listening(port)) return;
  throw new Error(`e2e: ${what} did not start listening within ${ms} ms`);
}

/**
 * Throws, naming what it heard, if anything sends sACN (E1.31) to this machine's port within `ms` (a player sends
 * every universe 40 times a second) or already listens there: a player or relay left running would play into the
 * relay this run starts, over our frames.
 */
export async function quietSacn(port = SACN_PORT, ms = 1500) {
  const suspects = () => named(/(^|\/)(sacn-play\.ts|relay\.js)$/).map((p) => `\n  ${p}`).join('')
    || ' none by name';
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: false });
  let heard = null;
  socket.on('message', (m, from) => {
    if (heard || m.length < 126 || m.toString('latin1', 4, 13) !== 'ASC-E1.17') return;
    const name = m.toString('utf8', 44, 108).replace(/\0.*$/s, '');
    heard = `"${name}" on universe ${m.readUInt16BE(113)}, from ${from.address}:${from.port}`;
  });
  try {
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.bind(port, resolve); });
  } catch (e) {
    socket.close();
    throw new Error(`e2e: UDP ${port} (sACN) is taken (${e.code}): stop what listens there. Candidates:${suspects()}`,
      { cause: e });
  }
  await sleep(ms);
  socket.close();
  if (heard) throw new Error(`e2e: something already sends sACN to :${port}: ${heard}. Candidates:${suspects()}`);
}

/** Starts and stops the chain's processes; output is kept for the findings when one fails. */
export class Stack {
  constructor({ httpPort = 8765, log = () => {} } = {}) {
    Object.assign(this, { httpPort, log, procs: new Map() });
  }

  start(name, cmd, args, opts = {}) {
    if (!this.onExit) process.once('exit', this.onExit = () => this.kill());
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts, detached: false, env: tagged(opts.env) });
    const entry = { p, out: '' };
    const keep = (d) => { entry.out = (entry.out + d).slice(-8000); };
    p.stdout.on('data', keep);
    p.stderr.on('data', keep);
    p.once('exit', (code, sig) => this.log(`${name} exited (${sig || code})`));
    this.procs.set(name, entry);
    return entry;
  }

  async up() {
    for (const [port, what] of [[this.httpPort, 'the static server'], [RELAY_PORT, 'the relay']]) {
      if (await listening(port)) throw new Error(`e2e: port ${port} is taken; stop what holds it (${what} runs there)`);
    }
    if (!existsSync(`${REPO}relay/node_modules/ws`)) {
      throw new Error('e2e: the relay needs its dependencies: (cd relay && npm install)');
    }
    this.start('http', 'python3', ['-m', 'http.server', String(this.httpPort), '--bind', '127.0.0.1',
      '--directory', REPO]);
    this.start('relay', process.execPath, ['relay.js'], { cwd: `${REPO}relay` });
    await waitForPort(this.httpPort, 15000, 'the static server');
    await waitForPort(RELAY_PORT, 15000, 'the relay');
    this.log(`stack up: http://localhost:${this.httpPort}/ and ws://localhost:${RELAY_PORT}`);
  }

  /** (Re)start the player on a file; args are sacn-play's options. */
  async play(file, args = []) {
    await this.stop('play');
    const entry = this.start('play', process.execPath, [`${STUDIO}tools/sacn-play.ts`, file, '--quiet', ...args]);
    await sleep(200);
    if (entry.p.exitCode !== null) throw new Error(`e2e: sacn-play stopped at once:\n${entry.out}`);
    return entry;
  }

  async stop(name) {
    const e = this.procs.get(name);
    if (!e) return;
    this.procs.delete(name);
    if (e.p.exitCode !== null || e.p.signalCode) return;
    const gone = new Promise((resolve) => e.p.once('exit', resolve));
    e.p.kill('SIGTERM');
    await Promise.race([gone, sleep(3000)]);
    if (e.p.exitCode === null && !e.p.signalCode) e.p.kill('SIGKILL');
  }

  /** Stops every helper, then kills anything they started that is still running. */
  async down() {
    for (const name of [...this.procs.keys()].reverse()) await this.stop(name);
    sweep(identity());
  }

  /** At once and synchronously (the worker is exiting): every helper and what it started. */
  kill() {
    for (const { p } of this.procs.values()) if (p.exitCode === null && !p.signalCode) p.kill('SIGKILL');
    sweep(identity());
  }

  output(name) {
    return this.procs.get(name)?.out ?? '';
  }
}
