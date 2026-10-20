// pi/src/server.ts: the control page's socket refuses other sites, asks for the PIN when one is set (locking out a
// guesser), passes what the page sends to the engine only once it may, refuses anything else, and slows a flood.
import assert from 'node:assert/strict';

import { afterEach, describe, test } from 'vitest';
import WebSocket from 'ws';

import type { PiState, ToPage } from '../src/protocol.ts';
import { CSP, controlServer } from '../src/server.ts';
import { engineOn } from './fixture.ts';

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.close(); });

async function serve(pin = '', clock = { t: 0 }, base = '') {
  const r = engineOn();
  r.engine.play('fire');
  r.run(0.3);
  const state = () => ({ ...r.engine.state(), looks: [], out: {} } as unknown as PiState);
  const s = await controlServer({ engine: r.engine, state, pin, port: 0, host: '127.0.0.1', base,
    now: () => clock.t });
  servers.push(s);
  return { ...r, origin: `http://127.0.0.1:${s.port}`, page: `http://127.0.0.1:${s.port}${base}`, clock };
}

/** A socket from `origin` (the page's own unless said), with every message it gets kept. */
async function socket(url: string, origin = new URL(url).origin) {
  const ws = new WebSocket(`${url.replace('http', 'ws')}/ws`, { origin });
  const got: ToPage[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d))));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const send = (m: object) => ws.send(JSON.stringify(m));
  /** The next message of `type`, waiting for it. */
  const next = async (type: ToPage['type'], from = got.length) => {
    for (let i = 0; i < 100; i++) {
      const m = got.slice(from).find((x) => x.type === type);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no ${type}: ${JSON.stringify(got)}`);
  };
  return { ws, got, send, next };
}

describe('the control page', () => {
  test('is served with the CSP; another site\'s socket is refused', async () => {
    const { origin } = await serve();
    const res = await fetch(origin);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-security-policy'), CSP);
    assert.match(await res.text(), /<title>Studio Live<\/title>/);
    await assert.rejects(socket(origin, 'http://evil.example'), /403/);
  });

  test('under a base, the page, its redirect and its socket are there, and nothing at /', async () => {
    const { origin, page } = await serve('', { t: 0 }, '/pi');
    assert.match(await (await fetch(`${page}/`)).text(), /<title>Studio Live<\/title>/);
    const bare = await fetch(page, { redirect: 'manual' });
    assert.deepEqual([bare.status, bare.headers.get('location')], [301, '/pi/']);
    assert.equal((await fetch(`${origin}/`)).status, 404);
    const c = await socket(page);
    c.send({ type: 'hello' });
    assert.equal(((await c.next('hello')) as { ok: boolean }).ok, true);
    await assert.rejects(socket(origin), /404/);
  });

  test('with no PIN, hello is enough; what it sends reaches the engine', async () => {
    const { origin, engine, run } = await serve();
    const c = await socket(origin);
    c.send({ type: 'hello' });
    assert.deepEqual(await c.next('hello'), { type: 'hello', ok: true, needPin: false });
    assert.equal(((await c.next('state')) as { state: PiState }).state.look?.id, 'fire');
    c.send({ type: 'blackout', on: true });
    c.send({ type: 'level', value: 0.5 });
    c.send({ type: 'set', name: 'heat', value: 0.9 });
    c.send({ type: 'play', id: 'beat-bars' });
    await new Promise((r) => setTimeout(r, 100));
    const s = engine.state();
    assert.deepEqual([s.blackout, s.level, s.switching], [true, 0.5, 'beat-bars']);
    run(0.1);
    assert.equal(engine.state().look?.controls.find((x) => x.name === 'heat')?.value, 0.9);
    // Each reply looked for after its own send: states arrive between them.
    let from = c.got.length;
    c.send({ type: 'play', id: 'nope' });
    assert.deepEqual(await c.next('error', from), { type: 'error', error: 'nope cannot play.' });
    from = c.got.length;
    c.send({ type: 'set', name: 'level', value: 'loud' });
    assert.deepEqual(await c.next('error', from), { type: 'error', error: 'Not a message this page sends.' });
  });

  test('with a PIN, nothing changes until it is said; five wrong ones lock it for a minute', async () => {
    const { origin, engine, clock } = await serve('2468');
    const c = await socket(origin);
    c.send({ type: 'hello' });
    assert.deepEqual(await c.next('hello'), { type: 'hello', ok: false, needPin: true });
    c.send({ type: 'blackout', on: true });
    assert.deepEqual(await c.next('error'), { type: 'error', error: 'Say the PIN first.' });
    assert.equal(engine.state().blackout, false);
    for (let i = 0; i < 5; i++) {
      const from = c.got.length;
      c.send({ type: 'hello', pin: '0000' });
      assert.equal(((await c.next('hello', from)) as { error: string }).error, 'Wrong PIN.');
    }
    let from = c.got.length;
    c.send({ type: 'hello', pin: '2468' });
    assert.match(((await c.next('hello', from)) as { error: string }).error, /Too many wrong PINs/);
    clock.t += 61_000;
    from = c.got.length;
    c.send({ type: 'hello', pin: '2468' });
    assert.deepEqual(await c.next('hello', from), { type: 'hello', ok: true, needPin: true });
    c.send({ type: 'blackout', on: true });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(engine.state().blackout, true);
  });

  test('a flood is told to slow down, then closed', async () => {
    const { origin } = await serve();
    const c = await socket(origin);
    const closed = new Promise<number>((resolve) => c.ws.once('close', resolve));
    for (let i = 0; i < 700; i++) c.send({ type: 'tap', at: i });
    assert.equal(await closed, 1008);
    assert.ok(c.got.some((m) => m.type === 'error' && m.error === 'Slow down.'));
  });
});
