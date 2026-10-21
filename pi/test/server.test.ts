// pi/src/server.ts: the control page's socket refuses other sites, asks for the PIN when one is set (locking out a
// guesser), counts the pages watching, passes what the page sends to the engine only once it may, refuses anything
// else, and slows a flood.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import type { PiState } from '../src/protocol.ts';
import { CSP } from '../src/server.ts';
import { serve, socket } from './sockets.ts';

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
    assert.deepEqual([s.blackout.on, s.level, s.switching?.id], [true, 0.5, 'beat-bars']);
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

  test('the queue: its own looks, a library look Studio sends (its code ours), and nothing else', async () => {
    const { origin, engine } = await serve();
    const page = await socket(origin), c = await socket(origin);
    page.send({ type: 'hello' });
    c.send({ type: 'hello', feed: true });
    await page.next('state');
    await c.next('state');
    page.send({ type: 'queue', id: 'beat-bars' });
    const look = { id: 'abc123', title: 'Mine', layers: [{ modules: [{ ref: 'clouds', code: 'while (true) {}' }] }] };
    c.send({ type: 'send', by: 'ana', item: { kind: 'live', look } });
    page.send({ type: 'send', by: 'ana', item: { kind: 'live', look } });
    assert.deepEqual(await page.next('error'), { type: 'error', error: 'Only Studio sends that.' });
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(engine.state().queue.map((q) => [q.id, q.kind, q.by]),
      [['beat-bars', 'look', undefined], ['abc123', 'live', 'ana']]);
    let from = c.got.length;
    const custom = { id: 'x', title: 'X', layers: [{ modules: [{ code: 'x' }] }] };
    c.send({ type: 'send', item: { kind: 'live', look: custom } });
    assert.deepEqual(await c.next('error', from),
      { type: 'error', error: 'Cannot play: layer 1, module 1: not a library module' });
    from = c.got.length;
    c.send({ type: 'blackout', on: true, pad: 'x'.repeat(2000) });
    assert.deepEqual(await c.next('error', from), { type: 'error', error: 'Too long.' });
    c.send({ type: 'unqueue', key: engine.state().queue[0]!.key });
    from = c.got.length;
    c.send({ type: 'send', item: { kind: 'baked', id: '../x', title: 'X', sha256: 'a'.repeat(64) } });
    assert.deepEqual(await c.next('error', from), { type: 'error', error: 'Not a message this page sends.' });
    c.send({ type: 'send', at: 'end', item: { kind: 'baked', id: 'abc124', title: 'Baked', sha256: 'a'.repeat(64) } });
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(engine.state().queue.map((q) => [q.id, q.kind]), [['abc123', 'live'], ['abc124', 'baked']]);
  });

  test('counts pages watching, not Studio\'s feed nor a socket yet to say hello', async () => {
    const { origin, server } = await serve();
    const feed = await socket(origin), page = await socket(origin);
    feed.send({ type: 'hello', feed: true });
    await feed.next('hello');
    assert.deepEqual([server.clients(), server.watching()], [2, 0]);
    page.send({ type: 'hello' });
    await page.next('hello');
    assert.equal(server.watching(), 1);
    page.ws.close();
    for (let i = 0; i < 100 && server.watching(); i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(server.watching(), 0);
  });

  test('with a PIN, nothing changes until it is said; five wrong ones lock it for a minute', async () => {
    const { origin, engine, clock } = await serve('2468');
    const c = await socket(origin);
    c.send({ type: 'hello' });
    assert.deepEqual(await c.next('hello'), { type: 'hello', ok: false, needPin: true });
    c.send({ type: 'blackout', on: true });
    assert.deepEqual(await c.next('error'), { type: 'error', error: 'Say the PIN first.' });
    assert.equal(engine.state().blackout.on, false);
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
    assert.equal(engine.state().blackout.on, true);
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
