// The live stage following /pi (SPEC-live "Following /pi"): an admin using a control on /pi makes the stage follow the
// dry-run engine, and every viewer gets what it plays; a controller's change takes the stage back; /pi's page is told
// who drives. Through a real engine behind the real proxy.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';
import WebSocket from 'ws';

import { engineOn } from '../pi/test/fixture.ts';
import { serverNow } from '../src/clock.ts';
import { controlServer } from '../pi/src/server.ts';
import { fakeBox, layer, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();

/** A socket at `url` as a browser opens it, its messages queued for next(type, ok?). */
function open(app, url, cookie) {
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}${url}`, { headers: { cookie, origin: app.base } });
  const queue = [];
  let wake = () => {};
  ws.on('message', (d) => { queue.push(JSON.parse(String(d))); wake(); });
  return {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    /** The next message of `type` that passes `ok` (others skipped). */
    async next(type, ok = () => true) {
      const until = Date.now() + 4000;
      for (;;) {
        const i = queue.findIndex((m) => m.type === type && ok(m));
        if (i >= 0) return queue.splice(0, i + 1).pop();
        if (Date.now() > until) throw new Error(`no ${type} message`);
        await new Promise((r) => { wake = r; setTimeout(r, 50); });
      }
    },
  };
}

describe('the stage following /pi', () => {
  let r, pi, app, ada, alice, carol, lookId, tick;
  beforeAll(async () => {
    r = engineOn();
    r.engine.play('fire');
    r.run(0.5);
    tick = setInterval(() => r.run(0.05), 50);
    pi = await controlServer({ engine: r.engine, state: () => ({ ...r.engine.state(), looks: [], out: {} }), pin: '',
      port: 0, host: '127.0.0.1', base: '/pi' });
    app = await startApp({ dataDir: mkdtempSync(path.join(tmpdir(), 'live-pi-')), admins: 'ada', curators: 'Carol',
      renderBox: fakeBox(), piPreview: `http://127.0.0.1:${pi.port}` });
    ada = await signup(app, 'ada');
    alice = await signup(app, 'alice');
    carol = await signup(app, 'carol');
    lookId = (await alice.post('/api/looks', { title: 'Live sea', layers: [layer()], shared: true })).json.look.id;
    assert.equal((await alice.post(`/api/looks/${lookId}/bake`)).status, 202);
    await app.bakes.idle();
    assert.equal((await carol.put(`/api/looks/${lookId}`, { reviewed: true })).status, 200);
  });
  afterAll(async () => { clearInterval(tick); await app?.close(); await pi?.close(); });

  test('a control used on /pi drives every viewer; a controller takes it back', async () => {
    const watch = open(app, '/api/live/socket', alice.cookie), drive = open(app, '/api/live/socket', carol.cookie);
    assert.equal((await watch.next('state')).live.driver, 'stage');
    await drive.next('state');
    const page = open(app, '/pi/ws', ada.cookie);
    page.ws.on('open', () => page.send({ type: 'hello' }));
    assert.equal((await page.next('driver')).from, 'live', '/pi is told Live control drives');

    page.send({ type: 'set', name: 'heat', value: 0.9 });
    assert.equal((await watch.next('state', (m) => m.live.driver === 'pi')).live.driver, 'pi');
    const first = await watch.next('pi', (m) => m.source);
    assert.equal(first.source.id, 'fire');
    assert.ok(first.source.layers[0].modules.every((m) => m.ref && !m.code), 'modules by ref, no code');
    assert.ok(Math.abs(first.at - serverNow()) < 2000, 'on the server\'s clock, which the wall clock steps away from');
    await watch.next('pi', (m) => m.now?.values.heat === 0.9 && m.now.rev === first.source.rev);
    assert.equal((await page.next('driver')).from, 'pi');

    page.send({ type: 'play', id: 'beat-bars' });
    await watch.next('pi', (m) => m.source?.id === 'beat-bars');

    // A member cannot take it; a controller's change does.
    watch.send({ type: 'play', lookId });
    await watch.next('error');
    assert.equal(app.hub.live.driver, 'pi');
    drive.send({ type: 'play', lookId });
    const back = await watch.next('state', (m) => m.live.driver === 'stage');
    assert.equal(back.live.look.title, 'Live sea');
    assert.equal((await page.next('driver')).from, 'live');

    page.send({ type: 'blackout', on: true });
    await watch.next('state', (m) => m.live.driver === 'pi');
    drive.send({ type: 'set', blackout: false });
    await watch.next('state', (m) => m.live.driver === 'stage');
    for (const s of [watch, drive, page]) s.ws.close();
  });
});
