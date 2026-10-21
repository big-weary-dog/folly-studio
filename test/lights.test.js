// Playing on the lights (SPEC-offline "Playing on the lights", src/lights.ts): a library-only look goes to the engine's
// queue live, by ref with no code; a look with custom code only as its current bake; the admin's toggle; who may
// queue; Studio's proxy passing pages no `send`. Through a real engine and Studio's real feed.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, test } from 'vitest';
import WebSocket from 'ws';

import { engineOn, lib } from '../pi/test/fixture.ts';
import { controlServer } from '../pi/src/server.ts';
import { layersHash, renderFields } from '../src/bake.ts';
import { playOf } from '../src/lights.ts';
import { piFeed } from '../src/live/pi-feed.ts';
import { layer, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const start = (opts) => startApp({ dataDir: mkdtempSync(path.join(tmpdir(), 'lights-')), ...opts });
const code = (name) => readFileSync(path.join(PUBLIC, 'patterns', `${name}.js`), 'utf8');
const libLook = (title) => ({ title, shared: true, layers: [{ id: 'l1', title: 'Fire', groups: ['cathedral'],
  modules: [{ id: 'a', kind: 'source', title: 'Fire', ref: 'fire', code: code('fire') }] }] });
/** `fn()` until it is truthy, or fails after 4 s. */
async function until(fn, what) {
  for (const end = Date.now() + 4000; Date.now() < end;) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => { setTimeout(r, 25); });
  }
  throw new Error(`never: ${what}`);
}

describe('playOf', () => {
  const bake = (look) => ({ status: 'done', ok: true, frames: { sha256: 'a'.repeat(64), bytes: 1 },
    layersHash: layersHash(renderFields(look)) });
  const lookOf = (layers, extra = {}) => ({ id: 'x', title: 'X', duration: 30, layers, ...extra });
  const library = new Set(['fire']);

  test('a library look plays live, its code left behind', () => {
    const play = playOf(lookOf([{ modules: [{ ref: 'fire', code: 'evil()' }], code: 'evil()' }]), library, true);
    assert.equal(play.kind, 'live');
    assert.doesNotMatch(JSON.stringify(play), /evil/);
    assert.deepEqual(play.look.layers, [{ modules: [{ ref: 'fire' }] }]);
  });

  test('custom code, or live looks off, plays its current bake or says why not', () => {
    const custom = lookOf([{ modules: [{ ref: 'fire' }, { code: 'mine()' }] }]);
    assert.match(playOf(custom, library, true).error, /^Has custom code: bake it .*bubblewrap/);
    assert.match(playOf(lookOf([{ modules: [{ ref: 'gone' }] }]), library, true).error, /custom code/);
    const lib1 = lookOf([{ modules: [{ ref: 'fire' }] }]);
    assert.match(playOf(lib1, library, false).error, /^Live looks are off: bake it/);
    assert.deepEqual(playOf({ ...lib1, bake: bake(lib1) }, library, false),
      { kind: 'baked', id: 'x', title: 'X', sha256: 'a'.repeat(64) });
    assert.equal(playOf({ ...custom, bake: bake(custom) }, library, true).kind, 'baked');
    // A bake of other code, or one that failed, is not current.
    assert.ok(playOf({ ...custom, bake: bake(lib1) }, library, true).error);
    assert.ok(playOf({ ...custom, bake: { ...bake(custom), ok: false } }, library, true).error);
  });
});

describe('Play on the lights', () => {
  let r, pi, app, ada, cara, bob, fire, custom, tick;
  const baked = [];
  beforeAll(async () => {
    r = engineOn([], undefined, async (id, sha256) => { baked.push([id, sha256]); throw new Error('no frames here'); });
    r.engine.play('fire');
    tick = setInterval(() => r.run(0.05), 50);
    pi = await controlServer({ engine: r.engine, lib, state: () => ({ ...r.engine.state(), looks: [], out: {} }),
      pin: '', port: 0, host: '127.0.0.1', base: '/pi' });
    app = await start({ profile: 'pi', publicDir: PUBLIC, admins: 'ada', curators: 'cara',
      piPreview: `http://127.0.0.1:${pi.port}` });
    [ada, cara, bob] = [await signup(app, 'ada'), await signup(app, 'cara'), await signup(app, 'bob')];
    fire = (await bob.post('/api/looks', libLook('Bob fire'))).json.look;
    custom = (await bob.post('/api/looks', { title: 'Mine', shared: true, layers: [layer()] })).json.look;
    await until(async () => (await cara.get('/api/lights')).json.engine, 'the feed connects');
  });
  afterAll(async () => { clearInterval(tick); await app?.close(); await pi?.close(); });

  test('says who may queue and how a look would play', async () => {
    assert.deepEqual((await bob.get('/api/lights')).json, { liveLooks: true, canQueue: false, engine: true });
    assert.deepEqual((await cara.get(`/api/lights?lookId=${fire.id}`)).json.play, { kind: 'live' });
    assert.match((await cara.get(`/api/lights?lookId=${custom.id}`)).json.play.error, /custom code/);
    assert.equal((await ada.get('/api/lights?lookId=nope')).status, 404);
  });

  test('a curator queues a library look; it reaches the engine by ref, as theirs', async () => {
    assert.equal((await bob.post('/api/lights/queue', { lookId: fire.id })).status, 403);
    const res = await cara.post('/api/lights/queue', { lookId: fire.id, at: 'end' });
    assert.deepEqual(res.json, { kind: 'live' });
    const item = await until(() => r.engine.state().queue.find((q) => q.id === fire.id), 'queued');
    assert.deepEqual({ ...item, key: '' }, { key: '', id: fire.id, title: 'Bob fire', kind: 'live', by: 'cara' });
    r.engine.unqueue(item.key);
  });

  test('custom code is refused live, and goes as its bake when current', async () => {
    const refused = await cara.post('/api/lights/queue', { lookId: custom.id });
    assert.equal(refused.status, 400);
    assert.match(refused.json.error, /Has custom code/);
    const look = app.store.looks.get(custom.id);
    const sha256 = 'b'.repeat(64);
    app.store.looks.update(custom.id, { bake: { source: 'render-box', status: 'done', ok: true,
      frames: { sha256, bytes: 1 }, layersHash: layersHash(renderFields(look)) } });
    assert.deepEqual((await cara.post('/api/lights/queue', { lookId: custom.id, at: 'next' })).json,
      { kind: 'baked' });
    // The engine loads it as next; this one has no frames, so it says so and goes on.
    await until(() => baked.some(([id, s]) => id === custom.id && s === sha256), 'the engine loads the bake');
    await until(() => r.log.some((l) => /cannot play baked/.test(l)), 'the engine says why');
    assert.equal(r.engine.state().look.id, 'fire');
  });

  test('admins turn live looks off and on; others may not', async () => {
    assert.equal((await cara.put('/api/admin/lights', { liveLooks: false })).status, 403);
    assert.equal((await ada.put('/api/admin/lights', { liveLooks: 'no' })).status, 400);
    assert.equal((await ada.put('/api/admin/lights', { liveLooks: false })).json.liveLooks, false);
    const off = await cara.post('/api/lights/queue', { lookId: fire.id });
    assert.equal(off.status, 400);
    assert.match(off.json.error, /Live looks are off/);
    assert.equal((await ada.put('/api/admin/lights', { liveLooks: true })).json.liveLooks, true);
  });

  test('pages cannot send through Studio\'s proxy', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/pi/ws`, { headers: { cookie: cara.cookie,
      origin: app.base } });
    await new Promise((ok, fail) => { ws.on('open', ok); ws.on('error', fail); });
    const before = r.engine.state().queue.length;
    ws.send(JSON.stringify({ type: 'hello' }));
    ws.send(JSON.stringify({ type: 'send', at: 'end', item: { kind: 'live', look: { id: 'x', title: 'X',
      layers: [{ modules: [{ ref: 'fire' }] }] } } }));
    ws.send(JSON.stringify({ type: 'queue', id: 'safe' }));
    await until(() => r.engine.state().queue.length > before, 'the queue message');
    assert.deepEqual(r.engine.state().queue.map((q) => q.id), ['safe']);
    ws.close();
  });
});

describe('without the engine', () => {
  test('a hosted server has no /api/lights; a Pi whose engine is down answers 503', async () => {
    const hosted = await start({ admins: 'ada', piPreview: 'http://127.0.0.1:9' });
    assert.equal((await (await signup(hosted, 'ada')).get('/api/lights')).status, 404);
    await hosted.close();
    const app = await start({ profile: 'pi', publicDir: PUBLIC, curators: 'cara', piPreview: 'http://127.0.0.1:9' });
    const cara = await signup(app, 'cara');
    const look = (await cara.post('/api/looks', libLook('Fire'))).json.look;
    assert.equal((await cara.get('/api/lights')).json.engine, false);
    const down = await cara.post('/api/lights/queue', { lookId: look.id });
    assert.equal(down.status, 503);
    await app.close();
  });
});

describe('the feed', () => {
  test('says PI_PIN in its hello, and passes the queue on in `now`', async () => {
    const r = engineOn();
    r.engine.play('fire');
    r.engine.queue('safe', 'end', 'cara');
    r.run(0.1);
    const pi = await controlServer({ engine: r.engine, lib, state: () => ({ ...r.engine.state(), looks: [], out: {} }),
      pin: '2468', port: 0, host: '127.0.0.1', base: '/pi' });
    const target = new URL(`http://127.0.0.1:${pi.port}`), nows = [];
    const wrong = piFeed({ target, pin: '1111', onNow: () => {}, onSource: () => {}, log: {} });
    const feed = piFeed({ target, pin: '2468', onNow: (n) => nows.push(n), onSource: () => {}, log: {} });
    await until(() => feed.connected() && nows.some((n) => n?.queue), 'the feed connects');
    assert.deepEqual(nows.find((n) => n?.queue).queue, [{ title: 'Safe: dim colour wash', kind: 'look', by: 'cara' }]);
    assert.equal(feed.queued(), 1);
    assert.equal(wrong.connected(), false);
    assert.equal(wrong.send({ type: 'next' }), false);
    feed.close();
    wrong.close();
    await pi.close();
  });
});
