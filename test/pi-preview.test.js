// src/pi-preview.ts: /pi passes a dry-run Studio Live through to signed-in admins only, page and socket, with the Pi's
// own CSP, and only from this site; without PI_PREVIEW_URL there is no /pi.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';
import WebSocket from 'ws';

import { engineOn } from '../pi/test/fixture.ts';
import { controlServer, CSP } from '../pi/src/server.ts';
import { signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const start = (opts) => startApp({ dataDir: mkdtempSync(path.join(tmpdir(), 'pi-preview-')), ...opts });

/** A socket to /pi/ws as a browser opens it: the first message, or the status it was refused with. */
function socket(app, cookie, origin = app.base) {
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/pi/ws`, { headers: { cookie, origin } });
  const got = [];
  const first = new Promise((resolve) => {
    ws.on('message', (d) => { got.push(JSON.parse(String(d))); resolve(got[0]); });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('error', () => {});
  });
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello' })));
  return { ws, got, first };
}

describe('the Pi preview at /pi', () => {
  let pi, r, app, ada, bob;
  beforeAll(async () => {
    r = engineOn();
    r.engine.play('fire');
    r.run(0.3);
    pi = await controlServer({ engine: r.engine, state: () => ({ ...r.engine.state(), looks: [], out: {} }), pin: '',
      mode: 'live',
      port: 0, host: '127.0.0.1', base: '/pi' });
    app = await start({ admins: 'ada', piPreview: `http://127.0.0.1:${pi.port}` });
    ada = await signup(app, 'ada');
    bob = await signup(app, 'bob');
  });
  afterAll(async () => { await app?.close(); await pi?.close(); });

  test('the page is for admins: no session is asked to sign in, a member refused', async () => {
    assert.equal((await fetch(`${app.base}/pi/`)).status, 401);
    assert.equal((await bob.get('/pi/')).status, 403);
    const res = await ada.get('/pi/');
    assert.equal(res.status, 200);
    assert.match(res.text, /<title>Studio Live<\/title>/);
    assert.equal(res.headers.get('content-security-policy'), CSP, "the Pi page's CSP, not the app's");
    assert.equal((await ada.get('/pi')).status, 200, 'redirected to /pi/');
    assert.equal((await ada.get('/pi/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  });

  test("an admin's socket drives the Pi; a member's, another site's or none is refused", async () => {
    const s = socket(app, ada.cookie);
    assert.deepEqual(await s.first, { type: 'hello', ok: true, needPin: false,
      you: { name: 'ada', drive: true } });
    s.ws.send(JSON.stringify({ type: 'blackout', on: true }));
    for (let i = 0; i < 50 && !r.engine.state().blackout.on; i++) await new Promise((res) => setTimeout(res, 10));
    assert.equal(r.engine.state().blackout.on, true);
    s.ws.close();
    assert.equal(await socket(app, bob.cookie).first, 403);
    assert.equal(await socket(app, '').first, 401);
    assert.equal(await socket(app, ada.cookie, 'http://evil.example').first, 403);
  });

  test('a page is who its session says, never Studio\'s feed, and cannot set the mode', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/pi/ws`, { headers: { cookie: ada.cookie, origin: app.base } });
    const got = [];
    ws.on('message', (d) => got.push(JSON.parse(String(d))));
    await new Promise((ok) => { ws.on('open', ok); });
    ws.send(JSON.stringify({ type: 'hello', feed: true, who: { name: 'mallory', drive: true } }));
    ws.send(JSON.stringify({ type: 'mode', mode: 'jukebox' }));
    ws.send(JSON.stringify({ type: 'blackout', on: false }));
    ws.send(JSON.stringify({ type: 'blackout', on: true }));
    const last = () => got.filter((m) => m.type === 'state').at(-1)?.state;
    for (let i = 0; i < 100 && !(last()?.blackout.on && last().blackout.ago === 0); i++) {
      await new Promise((res) => setTimeout(res, 10));
    }
    assert.deepEqual([last().mode, last().here, last().blackout.by], ['live', ['ada'], 'ada']);
    ws.send(JSON.stringify({ type: 'blackout', on: false }));
    ws.close();
  });

  test('a preview that is not running is a 502', async () => {
    const down = await start({ admins: 'ada', piPreview: 'http://127.0.0.1:9' });
    const a = await signup(down, 'ada');
    assert.equal((await a.get('/pi/')).status, 502);
    await down.close();
  });

  test('without PI_PREVIEW_URL there is no /pi, and a bad one stops the server', async () => {
    const plain = await start({ admins: 'ada' });
    const a = await signup(plain, 'ada');
    assert.doesNotMatch((await a.get('/pi/')).text, /Studio Live/);
    await plain.close();
    await assert.rejects(startApp({ piPreview: 'http://127.0.0.1:4043/pi' }), /PI_PREVIEW_URL must be/);
  });
});
