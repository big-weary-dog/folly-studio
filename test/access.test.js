// Access (SPEC "Access"): paid models need an unlocked account, Sketch never does; invite codes are stored hashed,
// redeemed once, refused when used up, expired or revoked, and tried a limited number of times; each account's ideas
// are limited (an hour, a day, at once, a model's own, a ceiling for everyone), admins exempt or overriding.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { HOUR_MS } from '../src/access.ts';
import { FIX } from './fixtures/generate/shared.js';
import { client, fx, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const BIN = path.join(FIX, 'bin');

describe('access', () => {
  let app, admin, n = 0;
  const someone = () => signup(app, `person-${++n}`);
  const unlock = (who) => admin.put(`/api/admin/people/${who.user.id}`, { unlocked: true });
  const idea = (who, model = 'sol', text = 'stars over the arches') => who.post('/api/ideas', { text, model });
  const code = async (body = {}) => (await admin.post('/api/admin/invites', body)).json;
  /** The registry's limits, as an admin would save them. */
  const setLimits = async (limits, models = {}) => {
    const { config } = (await admin.get('/api/admin/models')).json;
    const saved = await admin.put('/api/admin/models', { ...config, limits: { ...config.limits, ...limits },
      models: config.models.map((m) => (m.id in models ? { ...m, limits: models[m.id] } : m)) });
    assert.equal(saved.status, 200, saved.json.error);
  };
  const finish = (who) => app.store.ideas.list((i) => i.owner === who.user.id && i.status === 'queued')
    .forEach((i) => app.store.ideas.update(i.id, { status: 'ready' }));

  beforeAll(async () => {
    app = await startApp({ dataDir: path.join(fx.tmp, 'data-access'), admins: 'ada', models: { env: { PATH: BIN } } });
    admin = await signup(app, 'ada');
  });
  afterAll(() => app?.close());

  test('a locked account is refused the paid models (403, with its access), never Sketch', async () => {
    const mo = await someone();
    const me = (await mo.get('/api/me')).json.access;
    assert.deepEqual([me.unlocked, me.exempt, me.inviteOnly, me.limits, me.left], [false, false, true,
      { perHour: 6, perDay: 20, concurrent: 2 }, { hour: 6, day: 20, running: 2 }]);
    const refused = await idea(mo);
    assert.equal(refused.status, 403);
    assert.equal(refused.json.error, 'Sol needs an invite code. Sketch is free for everyone.');
    assert.equal(refused.json.access.unlocked, false);
    assert.equal((await idea(mo, 'sketch')).status, 201);
    assert.equal((await mo.get('/api/me')).json.access.left.hour, 6, 'Sketch spends none of the allowance');
    assert.equal((await idea(admin)).status, 201, 'admins are exempt');
    assert.equal((await admin.get('/api/me')).json.access.exempt, true);
  });

  test('a code is made by an admin, shown once, stored hashed, and redeemed once', async () => {
    const mo = await someone(), jo = await someone();
    assert.equal((await mo.post('/api/admin/invites', {})).status, 403);
    assert.equal((await mo.get('/api/admin/people')).status, 403);
    const made = await code({ label: 'art crew' });
    assert.match(made.code, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    assert.deepEqual([made.invite.uses, made.invite.used, made.invite.state, made.invite.label], [1, 0, 'active',
      'art crew']);
    assert.equal('hash' in made.invite, false);
    await app.store.flush();
    const disk = fs.readFileSync(path.join(fx.tmp, 'data-access', 'invites.json'), 'utf8');
    assert.ok(!disk.includes(made.code) && !disk.includes(made.code.replaceAll('-', '')), 'only its hash is kept');

    const typed = ` ${made.code.toLowerCase().replaceAll('-', ' ')} `; // case and spacing do not matter
    const ok = await mo.post('/api/invite', { code: typed });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.access.unlocked, true);
    assert.equal((await idea(mo)).status, 201);
    assert.equal((await mo.post('/api/invite', { code: made.code })).status, 200, 'unlocked already: no change');
    const taken = await jo.post('/api/invite', { code: made.code });
    assert.equal(taken.status, 400, 'its one use is spent');
    const listed = (await admin.get('/api/admin/invites')).json.invites.find((i) => i.id === made.invite.id);
    assert.deepEqual([listed.used, listed.state], [1, 'used']);
    const person = (await admin.get('/api/admin/people')).json.people.find((p) => p.id === mo.user.id);
    assert.equal(person.access.invite, made.invite.id);
    assert.equal(person.used.day, 1);
  });

  test('expired and revoked codes are refused; a code of many uses serves many', async () => {
    const many = await code({ uses: 2, days: 7 });
    assert.ok(Date.parse(many.invite.expiresAt) > Date.now() + 6 * 24 * HOUR_MS);
    const [a, b, c] = [await someone(), await someone(), await someone()];
    assert.equal((await a.post('/api/invite', { code: many.code })).status, 200);
    assert.equal((await b.post('/api/invite', { code: many.code })).status, 200);
    assert.equal((await c.post('/api/invite', { code: many.code })).status, 400);

    const old = await code({ days: 1 });
    app.store.invites.update(old.invite.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal((await c.post('/api/invite', { code: old.code })).status, 400);
    assert.equal((await admin.get('/api/admin/invites')).json.invites.find((i) => i.id === old.invite.id).state,
      'expired');

    const gone = await code();
    const revoked = await admin.req('DELETE', `/api/admin/invites/${gone.invite.id}`);
    assert.deepEqual([revoked.status, revoked.json.invite.state], [200, 'revoked']);
    assert.equal((await c.post('/api/invite', { code: gone.code })).status, 400);
    assert.equal((await admin.req('DELETE', '/api/admin/invites/nope')).status, 404);
    assert.equal((await c.get('/api/me')).json.access.unlocked, false);
    assert.equal((await admin.post('/api/admin/invites', { uses: 0 })).status, 400);
  });

  test('redeeming is limited: 5 failures per account, 20 tries per address, in 15 minutes', async () => {
    const mo = await someone();
    for (let i = 0; i < 5; i++) assert.equal((await mo.post('/api/invite', { code: 'AAAA-BBBB-CCCC' })).status, 400);
    const valid = await code();
    const stopped = await mo.post('/api/invite', { code: valid.code });
    assert.equal(stopped.status, 429, 'even a good code waits');
    assert.ok(Number(stopped.headers.get('retry-after')) > 0);
    const jo = await someone();
    assert.equal((await jo.post('/api/invite', { code: valid.code })).status, 200, 'another account may');

    const ip = await startApp({ dataDir: path.join(fx.tmp, 'data-access-ip'), models: { env: { PATH: BIN } } });
    try {
      const people = await Promise.all([1, 2, 3, 4, 5].map((i) => signup(ip, `ip-${i}`)));
      const tries = [];
      for (const p of people) {
        for (let i = 0; i < 4; i++) tries.push((await p.post('/api/invite', { code: 'x' })).status);
      }
      assert.deepEqual([...new Set(tries)], [400]);
      assert.equal((await people[0].post('/api/invite', { code: 'x' })).status, 429, 'the address has had 20');
    } finally { await ip.close(); }
  });

  test('limits: at once, an hour, a day; 429 with the access and Retry-After; one idea one use', async () => {
    const mo = await someone();
    await unlock(mo);
    assert.equal((await idea(mo)).status, 201);
    assert.equal((await idea(mo, 'luna')).status, 201);
    const busy = await idea(mo);
    assert.equal(busy.status, 429, 'two at once');
    assert.match(busy.json.error, /being made already/);
    assert.equal(busy.json.access.left.running, 0);
    // The job failing, a retry or the fallback changes nothing: the idea was the use.
    const first = app.store.ideas.list((i) => i.owner === mo.user.id)[0];
    app.store.ideas.update(first.id, { status: 'failed', generator: 'sketch' });
    finish(mo);
    for (let i = 0; i < 4; i++) {
      assert.equal((await idea(mo, 'sol', `idea ${i}`)).status, 201, `idea ${i}`);
      finish(mo);
    }
    const hour = await idea(mo);
    assert.equal(hour.status, 429);
    assert.match(hour.json.error, /^That's your 6 ideas this hour\. Try again in 60 min\.$/);
    assert.ok(Number(hour.headers.get('retry-after')) > 3500);
    const me = (await mo.get('/api/me')).json.access;
    assert.deepEqual(me.left, { hour: 0, day: 14, running: 2 });
    assert.ok(Date.parse(me.nextAt) > Date.now() + 59 * 60_000);
    // An hour on, the hour's uses are free again but the day's still count.
    const u = app.store.users.get(mo.user.id), sol = app.models.get('sol');
    assert.equal(app.access.check(u, sol, Date.now() + HOUR_MS + 1000), null);
    assert.equal(app.access.state(u, Date.now() + HOUR_MS + 1000).left.day, 14);
    assert.equal((await idea(mo, 'sketch')).status, 201, 'Sketch has its own');
  });

  test('an admin raises or resets one person; a model may cap itself; a ceiling holds everyone', async () => {
    const mo = await someone();
    await unlock(mo);
    const raised = await admin.put(`/api/admin/people/${mo.user.id}`, { limits: { perHour: 8, concurrent: 4 } });
    assert.deepEqual(raised.json.person.access.limits, { perHour: 8, concurrent: 4 });
    for (let i = 0; i < 8; i++) {
      assert.equal((await idea(mo, 'sol', `raised ${i}`)).status, 201);
      finish(mo);
    }
    assert.equal((await idea(mo)).status, 429);
    const reset = await admin.put(`/api/admin/people/${mo.user.id}`, { reset: true, limits: null });
    assert.deepEqual(reset.json.person.used, { hour: 0, day: 0, running: 0 });
    assert.equal((await mo.get('/api/me')).json.access.left.hour, 6);
    assert.equal((await admin.put(`/api/admin/people/${mo.user.id}`, { limits: { perHour: -1 } })).status, 400);
    // A cap of 0 is none at all: no time to try again, and no Retry-After.
    for (const limits of [{ perHour: 0 }, { concurrent: 0 }]) {
      await admin.put(`/api/admin/people/${mo.user.id}`, { limits });
      const none = await idea(mo);
      assert.equal(none.status, 429);
      assert.match(none.json.error, /^Your allowance for ideas (this hour|at once) is 0: ask an admin\.$/);
      assert.equal(none.headers.get('retry-after'), null);
      assert.equal(none.json.access.nextAt, undefined);
    }
    await admin.put(`/api/admin/people/${mo.user.id}`, { limits: null });
    assert.equal((await admin.put('/api/admin/people/nobody', { reset: true })).status, 404);

    await setLimits({}, { luna: { perDay: 1 } });
    assert.equal((await idea(mo, 'luna')).status, 201);
    finish(mo);
    const luna = await idea(mo, 'luna');
    assert.equal(luna.status, 429);
    assert.match(luna.json.error, /^That's your 1 ideas on Luna today\./);
    assert.deepEqual(luna.json.access.models.luna, { day: 0 });
    assert.equal((await idea(mo, 'sol')).status, 201, 'the pool still has room');

    const paid = app.store.ideas.list((i) => i.model !== 'sketch').length;
    await setLimits({ dailyCeiling: paid });
    const full = await idea(mo);
    assert.equal(full.status, 429);
    assert.match(full.json.error, /^The AI models have done all they can for today\. Sketch is still free\./);
    assert.equal(full.json.access.full, true);
    assert.equal((await idea(admin)).status, 201, 'admins still may');
    assert.equal((await idea(mo, 'sketch')).status, 201);

    await setLimits({ inviteOnly: false, dailyCeiling: 1000 });
    const open = await someone();
    assert.equal((await open.get('/api/me')).json.access.unlocked, true);
    assert.equal((await idea(open)).status, 201, 'inviteOnly off: no code needed');
    const locked = await admin.put(`/api/admin/people/${mo.user.id}`, { unlocked: false });
    assert.equal(locked.json.person.access.unlockedAt, undefined);
  });

  test('a session is needed, and admin routes stay admin-only after login', async () => {
    assert.equal((await client(app).post('/api/invite', { code: 'x' })).status, 401);
    const again = client(app);
    assert.equal((await again.post('/api/login', { username: 'person-1', password: 'correct horse' })).status, 200);
    assert.equal((await again.get('/api/admin/invites')).status, 403);
  });
});
