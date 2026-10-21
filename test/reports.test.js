// F8 bug reports (SPEC "Bug reports"): the scrub, the store on disk and what it keeps, and the routes (anyone signed
// in files one, within its body limit and a limit per user; admins read them back).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { keepTail } from '../src/http.ts';
import { buildSha } from '../src/reports/build.ts';
import { createReports, reportFolders } from '../src/reports/store.ts';
import { piece, scrub, scrubText } from '../public/js/scrub.ts';
import { tmp } from './fixtures/generate/shared.js';
import { client, fx, quiet, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]).toString('base64')}`;
const report = (extra = {}) => ({ format: 1, at: new Date().toISOString(), note: 'It froze\nwhen I clicked',
  build: 'abc', page: { path: '/studio/x' }, sources: { studio: { look: { title: 'Reef' } } }, ...extra });

describe('the scrub', () => {
  test('secrets blanked, IPs masked, URLs without query or fragment, sizes cut', () => {
    assert.equal(scrubText('see http://u:p@host.example/a/b?code=1#invite=xyz from 10.0.0.12'),
      'see http://host.example/a/b from [ip]');
    assert.deepEqual(scrub({ token: 't', inviteCode: 'c', password: 'p', nested: { cookie: 'x', ok: 1 } }),
      { token: '[redacted]', inviteCode: '[redacted]', password: '[redacted]',
        nested: { cookie: '[redacted]', ok: 1 } });
    assert.deepEqual(scrub(new Map([['a', new Set([1, 2])]])), { a: [1, 2] });
    assert.deepEqual(piece({ small: 1 }), { small: 1 });
    assert.equal(piece({ more: Array.from({ length: 10 }, () => 'y'.repeat(9000)) }).cut, true);
  });

  test('the server keeps its last warn and error lines, scrubbed', () => {
    const log = keepTail(quiet, 2);
    log.info('not kept');
    log.warn('slow from 192.168.1.4');
    log.error(new Error('boom'));
    log.warn('third');
    assert.deepEqual(log.tail().map((l) => [l.level, l.text.split('\n')[0]]), [['error', 'Error: boom'],
      ['warn', 'third']]);
    assert.equal(keepTail(quiet).tail().length, 0);
  });

  test('the build is the checkout\'s commit, or GIT_SHA', () => {
    assert.match(buildSha(process.cwd(), ''), /^[0-9a-f]{12}$/);
    assert.equal(buildSha(process.cwd(), '0123456789abcdef'), '0123456789ab');
  });
});

describe('the store', () => {
  test('a folder per report: the JSON with the server\'s side, the shot beside it; list, get, shot', async () => {
    const dir = tmp('reports'), reports = createReports({ dir });
    const id = await reports.save(report({ screenshot: JPEG }), { user: { id: 'u1', username: 'mona' } });
    const [folder] = await reportFolders(dir);
    assert.equal(folder.id, id);
    assert.deepEqual(fs.readdirSync(path.join(dir, folder.name)).sort(), ['report.json', 'shot.jpg']);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, folder.name, 'report.json'), 'utf8'));
    assert.equal(saved.screenshot, undefined, 'the shot is a file, not in the JSON');
    assert.deepEqual((await reports.list()).map(({ at, ...s }) => s), [{ id, user: 'mona', path: '/studio/x',
      look: 'Reef', note: 'It froze', shot: true }]);
    assert.equal((await reports.get(id)).server.user.username, 'mona');
    assert.deepEqual([...await reports.shot(id)].slice(0, 3), [0xff, 0xd8, 0xff]);
    for (const bad of ['../x', 'nope', id.toUpperCase()]) assert.equal(await reports.get(bad), null);
  });

  test('keeps the newest within the count, the bytes and the days', async () => {
    const dir = tmp('reports-prune'), reports = createReports({ dir, keep: 2, days: 60 });
    fs.mkdirSync(path.join(dir, '2020-01-01T00-00-00-old000'), { recursive: true });
    fs.writeFileSync(path.join(dir, '2020-01-01T00-00-00-old000', 'report.json'), '{}');
    fs.mkdirSync(path.join(dir, 'not-ours'));
    for (let i = 0; i < 3; i++) await reports.save(report(), {});
    await reports.prune();
    const left = await reportFolders(dir);
    assert.equal(left.length, 2);
    assert.ok(!left.some((f) => f.id === 'old000'));
    assert.ok(fs.existsSync(path.join(dir, 'not-ours')), 'only folders it named are touched');
  });
});

describe('the routes', () => {
  let app, admin, member;
  beforeAll(async () => {
    app = await startApp({ dataDir: path.join(fx.tmp, 'data-reports'), admins: 'Olive' });
    admin = await signup(app, 'olive');
    member = await signup(app, 'mona');
  });
  afterAll(() => app?.close());

  test('filed by anyone signed in, with the server\'s side; read by admins only', async () => {
    assert.equal((await client(app).post('/api/reports', report())).status, 401);
    assert.equal((await member.post('/api/reports', report(), { origin: 'https://evil.example' })).status, 403);
    assert.equal((await member.post('/api/reports', { ...report(), note: 5 })).status, 400);
    const sent = await member.post('/api/reports', report({ screenshot: JPEG }));
    assert.equal(sent.status, 201, sent.text);
    const { id } = sent.json;
    const list = await admin.get('/api/admin/reports');
    assert.deepEqual(list.json.reports.map((r) => [r.id, r.user, r.note, r.shot]), [[id, 'mona', 'It froze', true]]);
    const got = (await admin.get(`/api/admin/reports/${id}`)).json.report;
    assert.deepEqual([got.server.user.username, got.note, typeof got.server.build], ['mona', report().note, 'string']);
    assert.ok(Array.isArray(got.server.logs));
    const shot = await admin.get(`/api/admin/reports/${id}/shot`);
    assert.deepEqual([shot.status, shot.headers.get('content-type')], [200, 'image/jpeg']);
    for (const p of ['', `/${id}`, `/${id}/shot`]) {
      assert.equal((await member.get(`/api/admin/reports${p}`)).status, 403, p);
    }
    assert.equal((await admin.get('/api/admin/reports/zzzzzzzz')).status, 404);
  });

  test('a body past 3 MB is 413 (the page sends it again without the shot); 10 an hour each', async () => {
    const big = `data:image/jpeg;base64,${'A'.repeat(3.2 * 2 ** 20)}`;
    assert.equal((await member.post('/api/reports', report({ screenshot: big }))).status, 413);
    const other = await signup(app, 'nell');
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await other.post('/api/reports', report())).status);
    assert.deepEqual([codes.slice(0, 10).every((c) => c === 201), codes[10]], [true, 429]);
  });
});
