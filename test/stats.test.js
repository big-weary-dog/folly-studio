// The request log and Admin → Stats (SPEC-access "Stats"): a line per request worth reading, with no query, cookie
// or address in it; the day's visitors told apart by a salted hash; the counts admins alone read.
import assert from 'node:assert/strict';
import path from 'node:path';

import { afterAll, beforeAll, describe, test, vi } from 'vitest';

import { createStats } from '../src/stats.ts';

import { signup } from './fixtures/app.js';
import { fx, rawGet, startApp, useFixture } from './fixtures/server.js';

useFixture();
const lines = [];
const say = (...a) => lines.push(a.join(' '));
const log = Object.assign(say, { info: say, debug() {}, warn() {}, error() {} });
const logged = () => lines.filter((l) => l.startsWith('[http] '));

describe('the request log and the stats', () => {
  let app, admin, member;
  beforeAll(async () => {
    app = await startApp({ dataDir: path.join(fx.tmp, 'data-stats'), admins: 'adah', trustProxy: true, log });
    admin = await signup(app, 'adah');
    member = await signup(app, 'bodie');
  });
  afterAll(() => app?.close());

  test('a line per page and API call: method, route, status, time, size, visitor; no query or cookie', async () => {
    lines.length = 0;
    const page = await fetch(`${app.base}/looks/abc?token=hunter2`, { headers: { 'user-agent': 'A',
      'cf-ipcountry': 'NZ', cookie: 'studio_session=s3cret' } });
    assert.equal(page.status, 200);
    await member.get('/api/looks/nope?secret=x');
    await fetch(`${app.base}/js/main.js`);
    await fetch(`${app.base}/api/looks/x/preview/y.webp`);
    const [view, missing, preview, ...rest] = logged();
    assert.match(view, /^\[http\] GET \/looks\/abc 200 \d+ms \d+B v=[0-9a-f]{8} NZ$/);
    assert.match(missing, /^\[http\] GET \/api\/looks\/:id 404 \d+ms \d+B v=[0-9a-f]{8}$/);
    assert.match(preview, /^\[http\] GET \/api\/looks\/:id\/preview\/:name 40\d /, 'a quiet route that fails');
    assert.deepEqual(rest, [], 'a file served is counted, not logged');
    assert.doesNotMatch(lines.join('\n'), /hunter2|secret|s3cret|127\.0\.0\.1/);
  });

  test('admins read the stats; anyone else is refused', async () => {
    assert.equal((await member.get('/api/admin/stats')).status, 403);
    for (const ua of ['A', 'A', 'B']) await fetch(`${app.base}/`, { headers: { 'user-agent': ua } });
    const shell = await fetch(`${app.base}/`, { headers: { 'user-agent': 'B' } });
    const again = await rawGet(app.port, '/', { 'user-agent': 'B', 'if-none-match': shell.headers.get('etag') });
    assert.equal(again.status, 304, 'a page revalidated is a view too');
    const { status, json } = await admin.get('/api/admin/stats');
    assert.equal(status, 200);
    const [today, ...older] = json.days;
    assert.deepEqual(older, []);
    assert.match(today.day, /^\d{4}-\d\d-\d\d$/);
    assert.equal(today.views, 6);
    assert.equal(today.visitors, 2, 'one browser and address is one visitor, whichever page');
    assert.equal(today.people, 1, 'bodie, signed in; adah only now, as this answer is sent');
    assert.ok(today.requests >= 10);
    assert.equal(today.errors, 0);
    assert.ok(json.uptime >= 0 && json.memory.rss > 0 && json.memory.heap > 0);
    assert.deepEqual(json.bakes, { done: 0, failed: 0, waiting: 0 });
    assert.deepEqual(json.slowest, []);
  });
});

describe('the counts', () => {
  const store = { looks: { list: () => [] } };
  const req = (url, route = url) => ({ url, method: 'GET', ip: '10.1.2.3', headers: {}, routeOptions: { url: route } });
  const reply = (ms, status = 200) => ({ statusCode: status, elapsedTime: ms, getHeader: () => undefined });

  test('slow requests, the slowest kept; a day ends', async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 21, 23, 59) });
    try {
      const stats = createStats({ log, store });
      await stats.onResponse(req('/api/looks'), reply(1500, 500));
      for (let i = 0; i < 12; i++) await stats.onResponse(req('/api/library'), reply(1000 + i));
      let s = stats.read();
      assert.deepEqual(s.days.map((d) => [d.day, d.requests, d.slow, d.errors]), [['2026-10-21', 13, 13, 1]]);
      assert.equal(s.slowest.length, 10);
      assert.equal(s.slowest[0].ms, 1011);
      vi.setSystemTime(new Date(2026, 9, 22, 0, 1));
      await stats.onResponse(req('/'), reply(5));
      s = stats.read();
      assert.deepEqual(s.days.map((d) => [d.day, d.requests]), [['2026-10-22', 1], ['2026-10-21', 13]]);
      stats.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  test('a day that ends is one journal line, with no request to end it', async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 21, 23, 58) });
    try {
      const stats = createStats({ log, store });
      await stats.onResponse(req('/api/looks'), reply(1500, 500));
      lines.length = 0;
      vi.advanceTimersByTime(60_000);
      assert.deepEqual(lines, [], 'not before the day ends');
      vi.advanceTimersByTime(2 * 60_000);
      assert.equal(lines.length, 1);
      assert.match(lines[0], new RegExp('^\\[stats\\] 2026-10-21 visitors=0 people=0 views=0 requests=1 errors=1 '
        + 'slow=1 bakes=0/0/0 uptime=\\d+s rss=\\d+MB$'));
      vi.advanceTimersByTime(24 * 3_600_000);
      assert.match(lines[1], /^\[stats\] 2026-10-22 .* requests=0 /, 'a quiet day too');
      // A request just after midnight, before the timer: it ends the day, and the timer then has none to end.
      vi.setSystemTime(new Date(2026, 9, 24, 0, 0, 0, 100));
      await stats.onResponse(req('/api/looks'), reply(5));
      vi.advanceTimersByTime(5000);
      const days = () => lines.filter((l) => l.startsWith('[stats]')).map((l) => l.slice(8, 18));
      assert.deepEqual(days(), ['2026-10-21', '2026-10-22', '2026-10-23'], 'each day once');
      stats.stop();
      vi.advanceTimersByTime(48 * 3_600_000);
      assert.equal(days().length, 3, 'stopped');
    } finally {
      vi.useRealTimers();
    }
  });
});
