// The live stage (SPEC-live): its state rules on the server and their browser twin, the settings, and the socket
// (sessions, origin, who controls, what may play, limits, persistence). The browser sync is test/e2e/live.spec.js.
import assert from 'node:assert/strict';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';
import WebSocket from 'ws';

import { MAX_LANES } from '../public/js/pattern-core.ts';
import * as twin from '../public/js/ui/live/lanes.ts';
import { meter } from '../src/live/hub.ts';
import { liveSettings, playableLook } from '../src/live/routes.ts';
import { applySet, emptyLive, LEAD_MS, RAMP, roll, showTime, switchTo } from '../src/live/state.ts';
import { fakeBox, fx, layer, signup, startApp, useFixture } from './fixtures/server.js';

const BY = { id: 'u1', username: 'carol' };
const LOOK = { id: 'look1', title: 'Sea', ownerName: 'alice', duration: 10, layers: [layer(), layer({ id: 'l2' })],
  globals: { macros: { swell: { min: 0, max: 4, value: 1 } } }, automation: { speed: [[0, 1], [10, 2]] } };
const on = (now = 0) => switchTo(emptyLive(), structuredClone(LOOK), BY, now);
const set = (msg) => ({ type: 'set', ...msg });

describe('live state', () => {
  test('show time loops over the look from its start', () => {
    const live = on(1000);
    assert.equal(live.startedAt, 1000 + LEAD_MS);
    assert.deepEqual(showTime(live, live.startedAt + 2500), { loop: 0, t: 2.5 });
    assert.deepEqual(showTime(live, live.startedAt + 23_000), { loop: 2, t: 3 });
    assert.deepEqual(showTime(live, 0), { loop: 0, t: 0 }, 'before it starts: its first frame');
  });

  test('a push ramps from what plays to the value, at its show time', () => {
    const live = on(0), now = live.startedAt + 2000 - LEAD_MS;
    const u = applySet(live, set({ values: { level: 0.4 } }), BY, now);
    assert.equal(u.rev, live.rev);
    assert.equal(u.at, now + LEAD_MS);
    assert.deepEqual(u.lanes.level, [[0, 1], [2, 1], [2 + RAMP, 0.4]]);
    assert.deepEqual(u.held, { level: 1 });
    // One more within the ramp moves its end rather than adding points.
    const v = applySet(live, set({ values: { level: 0.2 } }), BY, now + 20);
    assert.deepEqual(v.lanes.level, [[0, 1], [2, 1], [2.07, 0.2]]);
    assert.ok(!('layers' in v) && !('blackout' in v), 'only what changed');
  });

  test("a pushed lane the look automates starts from the look's own lane", () => {
    const live = on(0), u = applySet(live, set({ values: { speed: 3 } }), BY, live.startedAt + 5000 - LEAD_MS);
    assert.deepEqual(u.lanes.speed, [[0, 1], [5, 1.5], [5 + RAMP, 3]]);
  });

  test('values are clamped to their range; unknown names and layers change nothing', () => {
    const live = on(0), now = live.startedAt;
    assert.deepEqual(applySet(live, set({ values: { swell: 9 } }), BY, now).lanes.swell.at(-1), [0.08, 4]);
    const before = structuredClone(live);
    assert.match(applySet(live, set({ values: { level: 0.5, nope: 1 } }), BY, now).error, /nope is not/);
    assert.match(applySet(live, set({ values: { level: 0.5 }, layers: { l9: { muted: true } } }), BY, now).error,
      /no layer l9/);
    assert.deepEqual(live, before);
    assert.match(applySet(emptyLive(), set({ blackout: true }), BY, now).error, /Nothing is playing/);
  });

  test('a release ramps back to the look and drops the name at the next loop', () => {
    const live = on(0), start = live.startedAt - LEAD_MS;
    applySet(live, set({ values: { level: 0.5 } }), BY, start + 1000);
    const u = applySet(live, set({ release: ['level'] }), BY, start + 3000);
    assert.deepEqual(u.lanes.level.slice(-2), [[3, 0.5], [3 + RAMP, 1]]);
    assert.deepEqual(u.drop, ['level']);
    const next = applySet(live, set({ values: { swell: 2 } }), BY, start + 12_000);
    assert.equal(next.loop, 1);
    assert.deepEqual(next.held, { swell: 1 }, 'level released; the lanes of loop 0 are gone');
  });

  test('a held value carries into the next loop', () => {
    const live = on(0);
    applySet(live, set({ values: { hue: 0.3 } }), BY, live.startedAt);
    roll(live, 1);
    assert.deepEqual(live.lanes, {});
    assert.equal(live.held.hue, 0.3);
    const u = applySet(live, set({ values: { hue: 0.45 } }), BY, live.startedAt + 14_000 - LEAD_MS);
    assert.deepEqual(u.lanes.hue, [[0, 0.3], [4, 0.3], [4 + RAMP, 0.45]]);
  });

  test('layers, blackout, and the lane cap', () => {
    const live = on(0);
    const u = applySet(live, set({ layers: { l2: { muted: true } }, blackout: true }), BY, live.startedAt);
    assert.deepEqual(u.layers, { l2: { muted: true } });
    assert.equal(u.blackout, true);
    assert.equal(switchTo(live, LOOK, BY, 5).blackout, true, 'blackout outlasts a switch');
    const many = { ...LOOK, automation: Object.fromEntries(Array.from({ length: MAX_LANES }, (_, i) => [`m${i}`,
      [[0, 0]]])) };
    const full = switchTo(emptyLive(), many, BY, 0);
    assert.match(applySet(full, set({ values: { level: 0.5 } }), BY, full.startedAt).error, /At most 16 lanes/);
  });

  test('a viewer applying the updates has what the server has', () => {
    const live = on(0), seen = structuredClone(live), start = live.startedAt - LEAD_MS;
    for (const [at, msg] of [[500, { values: { level: 0.5 } }], [4000, { values: { swell: 3 } }],
      [7000, { release: ['level'] }], [13_000, { values: { hue: 0.4 } }], [25_000, { values: { swell: 0 } }]]) {
      const u = JSON.parse(JSON.stringify(applySet(live, set(msg), BY, start + at)));
      assert.ok(twin.applyUpdate(seen, u));
    }
    for (const k of ['rev', 'loop', 'held', 'lanes', 'drop']) assert.deepEqual(seen[k], live[k], k);
    assert.equal(twin.applyUpdate(seen, { ...applySet(live, set({ values: { hue: 0 } }), BY, start), rev: 99 }),
      false, 'out of order');
    for (const now of [0, 1234, 999_999]) assert.deepEqual(twin.showTime(live, now), showTime(live, now));
    const a = structuredClone(live), b = structuredClone(live);
    roll(a, a.loop + 1);
    twin.roll(b, b.loop + 1);
    assert.deepEqual(a, b);
  });

  test('the faders and what the sandbox plays', () => {
    const live = on(0);
    applySet(live, set({ values: { level: 0.25 } }), BY, live.startedAt + 1000);
    const auto = twin.stageAutomation(live);
    assert.deepEqual(auto.speed, LOOK.automation.speed, "the look's own lanes");
    assert.deepEqual(auto.level, live.lanes.level);
    const c = twin.controlsOf(live, 5);
    assert.deepEqual(c.find((x) => x.name === 'level'), { name: 'level', min: 0, max: 1, value: 0.25, held: true });
    assert.equal(c.find((x) => x.name === 'speed').value, 1.5);
    assert.deepEqual(c.find((x) => x.name === 'swell'), { name: 'swell', min: 0, max: 4, value: 1, held: false });
    const next = twin.controlsNow(live, live.startedAt + 10_500).find((x) => x.name === 'level');
    assert.equal(next.value, 0.25, 'into the next loop with no update: the pushed value, held');
    assert.equal(live.loop, 1);
  });

  test('a flood closes however it is spaced; a steady sender just over the rate never does', () => {
    const run = (n, gap) => {
      const c = { tokens: 60, at: 0, over: 0, warned: false }, seen = [];
      for (let i = 0; i < n; i++) seen.push(meter(c, i * gap));
      return seen;
    };
    // 0.2 ms apart, a token comes back every 165 messages: that must not forgive the run of drops.
    const slow = run(2000, 0.2);
    assert.equal(slow.filter((v) => v === 'warn').length, 1, 'warned once');
    assert.ok(slow.includes('close'), 'closed');
    assert.ok(run(400, 0).includes('close'), 'all at once: closed');
    assert.ok(!run(2000, 1000 / 100).includes('close'), 'at 100 a second: dropped, never closed');
  });

  test('settings', () => {
    assert.deepEqual(liveSettings({}), { control: 'curators', looks: 'reviewed' });
    assert.deepEqual(liveSettings({ STUDIO_LIVE_CONTROL: ' Admins', STUDIO_LIVE_LOOKS: 'shared' }),
      { control: 'admins', looks: 'shared' });
    assert.deepEqual(liveSettings({ STUDIO_LIVE_CONTROL: 'everyone', STUDIO_LIVE_LOOKS: 'all' }),
      { control: 'curators', looks: 'reviewed' }, 'unknown values: the defaults');
    const look = { shared: true, reviewed: false, layers: [] };
    assert.equal(playableLook(look, { looks: 'reviewed' }), false);
    assert.equal(playableLook(look, { looks: 'shared' }), true);
    assert.equal(playableLook({ ...look, shared: false, reviewed: true }, { looks: 'shared' }), false);
  });
});

/** A socket as a browser opens it, with its messages queued for next(). */
function open(app, c, { origin = app.base } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/api/live/socket`, { headers: { cookie: c?.cookie ?? '',
    ...(origin ? { origin } : {}) } });
  const queue = [], waiting = [];
  ws.on('message', (d) => { const m = JSON.parse(String(d)); (waiting.shift() ?? ((x) => queue.push(x)))(m); });
  const failed = new Promise((resolve) => {
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('close', (code) => resolve(code));
  });
  return {
    ws, failed,
    send: (m) => ws.send(JSON.stringify(m)),
    /** The next message of `type` (others skipped). */
    async next(type) {
      for (;;) {
        const m = queue.shift() ?? await new Promise((r, j) => { waiting.push(r); setTimeout(() => j(
          new Error(`no ${type} message`)), 3000).unref(); });
        if (m.type === type) return m;
      }
    },
    close: () => ws.close(),
  };
}

describe('live socket', () => {
  useFixture();
  let app, alice, carol, lookId, dataDir;
  beforeAll(async () => {
    dataDir = path.join(fx.tmp, 'data-live');
    app = await startApp({ dataDir, curators: 'Carol', renderBox: fakeBox() });
    alice = await signup(app, 'alice');
    carol = await signup(app, 'carol');
    const look = (await alice.post('/api/looks', { title: 'Live sea', layers: [layer()], shared: true,
      globals: { level: 0.8 } })).json.look;
    lookId = look.id;
    assert.equal((await alice.post(`/api/looks/${lookId}/bake`)).status, 202);
    await app.bakes.idle();
    assert.equal((await carol.put(`/api/looks/${lookId}`, { reviewed: true })).status, 200);
  });
  afterAll(() => app.close());

  test('only a signed-in socket from this site opens', async () => {
    assert.equal(await open(app, null).failed, 401);
    assert.equal(await open(app, alice, { origin: 'https://evil.example' }).failed, 403);
    assert.equal(await open(app, alice, { origin: '' }).failed, 403);
  });

  test('a controller plays a look and pushes; every viewer gets it', async () => {
    const watch = open(app, alice), drive = open(app, carol);
    const first = await watch.next('state');
    assert.equal(first.control, false, 'members watch');
    assert.equal((await drive.next('state')).control, true, 'curators control');
    drive.send({ type: 'ping', id: 7 });
    const pong = await drive.next('pong');
    assert.equal(pong.id, 7);
    assert.ok(Math.abs(pong.now - Date.now()) < 1000);

    drive.send({ type: 'play', lookId });
    const [a, b] = await Promise.all([watch.next('state'), drive.next('state')]);
    assert.deepEqual(a.live, b.live);
    assert.equal(a.live.look.title, 'Live sea');
    assert.equal(a.live.look.ownerName, 'alice');
    assert.deepEqual(a.live.look.globals, { level: 0.8 });
    assert.equal(a.live.by.username, 'carol');

    drive.send({ type: 'set', values: { level: 0.3 }, blackout: true });
    const u = await watch.next('update');
    assert.equal(u.rev, a.live.rev + 1);
    assert.equal(u.lanes.level.at(-1)[1], 0.3);
    assert.equal(u.blackout, true);
    assert.deepEqual((await drive.next('presence')).controllers, ['carol']);

    watch.send({ type: 'set', blackout: false });
    assert.match((await watch.next('error')).error, /Only controllers/);
    watch.send({ type: 'whatever' });
    assert.match((await watch.next('error')).error, /not one the stage takes/);
    const snap = await alice.get('/api/live');
    assert.equal(snap.json.live.rev, u.rev);
    assert.equal(snap.json.control, false);
    assert.equal((await alice.get('/api/live/looks')).status, 403);
    assert.deepEqual((await carol.get('/api/live/looks')).json.looks.map((l) => l.id), [lookId]);
    watch.close();
    drive.close();
  });

  test('an unreviewed look does not play; switches are spaced', async () => {
    const other = (await alice.post('/api/looks', { title: 'Unreviewed', layers: [layer()], shared: true })).json.look;
    const drive = open(app, carol);
    await drive.next('state');
    drive.send({ type: 'play', lookId: other.id });
    assert.match((await drive.next('error')).error, /Only reviewed looks play/);
    drive.send({ type: 'play', lookId });
    await drive.next('state');
    drive.send({ type: 'play', lookId });
    assert.match((await drive.next('error')).error, /every 2 seconds/);
    drive.close();
  });

  test('a flood is refused, then closed', async () => {
    const drive = open(app, carol);
    await drive.next('state');
    for (let i = 0; i < 400; i++) drive.send({ type: 'ping', id: i });
    assert.match((await drive.next('error')).error, /Too many/);
    assert.equal(await drive.failed, 1008);
  });

  test('the stage survives a restart', async () => {
    const rev = app.hub.live.rev;
    await app.close();
    app = await startApp({ dataDir, curators: 'Carol', renderBox: fakeBox() });
    assert.equal(app.hub.live.rev, rev);
    assert.equal(app.hub.live.look.id, lookId);
  });
});
