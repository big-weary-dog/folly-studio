// The models API: GET /api/models for everyone signed in; the registry for admins only (STUDIO_ADMINS), its saves
// checked like any mutation; an idea's model refused unless it may run; and an idea followed by long polls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { FIX } from './fixtures/generate/shared.js';
import { client, fakeQueue, fx, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const BIN = path.join(FIX, 'bin');

describe('models API', () => {
  let app, admin, member, queue;
  beforeAll(async () => {
    queue = fakeQueue();
    const watchers = new Map();
    Object.assign(queue, {
      watch(id, fn) { watchers.set(id, fn); return () => watchers.delete(id); },
      touch(id, patch) { app.store.ideas.update(id, patch); watchers.get(id)?.(); },
    });
    app = await startApp({ dataDir: path.join(fx.tmp, 'data-models'), admins: 'Olive', generator: queue,
      models: { env: { PATH: BIN } } });
    admin = await signup(app, 'olive');
    member = await signup(app, 'mona');
  });
  afterAll(() => app?.close());

  test('roles: admins are also curators', async () => {
    assert.equal(admin.user.role, 'admin');
    assert.equal(member.user.role, 'member');
    assert.equal(app.auth.isCurator(app.store.users.get(admin.user.id)), true);
  });

  test('everyone signed in sees what they may pick; the registry is for admins only', async () => {
    const explores = { paid: true, explores: true };
    assert.deepEqual((await member.get('/api/models')).json, { default: 'sketch', models: [{ id: 'sol', label: 'Sol',
      ...explores }, { id: 'luna', label: 'Luna', ...explores }, { id: 'sketch', label: 'Sketch', paid: false }] },
    'no API key here: no Opus; a locked account starts on Sketch; Deep is off, so no deep');
    assert.equal((await admin.get('/api/models')).json.default, 'sol', 'the default the file names can run: Sol');
    assert.equal((await client(app).get('/api/models')).status, 401);
    assert.equal((await member.get('/api/admin/models')).status, 403);
    assert.equal((await member.put('/api/admin/models', {})).status, 403);
    const { status, json } = await admin.get('/api/admin/models');
    assert.equal(status, 200);
    assert.equal(json.file, path.join(fx.tmp, 'data-models', 'models.json'));
    assert.deepEqual(json.models.map((m) => [m.id, m.available]), [['opus', false], ['sol', true], ['luna', true],
      ['sketch', true]]);
    assert.deepEqual(json.efforts.codex, ['minimal', 'low', 'medium', 'high', 'xhigh']);
  });

  test('a save is checked (400 names the problem), same-origin JSON only, and applies at once', async () => {
    const { config } = (await admin.get('/api/admin/models')).json;
    const bad = { ...config, models: config.models.map((m) => (m.id === 'sol' ? { ...m, effort: 'max' } : m)) };
    const refused = await admin.put('/api/admin/models', bad);
    assert.equal(refused.status, 400);
    assert.match(refused.json.error, /^Model 2 \(sol\): effort must be one of minimal, low, .* for codex\.$/);
    assert.equal((await admin.put('/api/admin/models', config, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await admin.put('/api/admin/models', JSON.stringify(config), { 'content-type': 'text/plain' }))
      .status, 415);
    const next = { ...config, default: 'luna',
      models: config.models.map((m) => (m.id === 'sol' ? { ...m, enabled: false } : m)) };
    const ok = await admin.put('/api/admin/models', next);
    assert.equal(ok.status, 200);
    assert.equal(ok.json.config.default, 'luna');
    assert.equal(JSON.parse(fs.readFileSync(ok.json.file, 'utf8')).default, 'luna');
    assert.deepEqual((await member.get('/api/models')).json.models.map((m) => m.id), ['luna', 'sketch']);
  });

  test('an idea asks for a model it may have, else 400; none gets the default', async () => {
    const post = (body) => member.post('/api/ideas', body);
    assert.equal((await post({ text: 'stars', model: 'opus' })).json.error, 'Opus is not set up on this server '
      + 'right now.');
    assert.equal((await post({ text: 'stars', model: 'sol' })).json.error, 'Sol is turned off.');
    assert.equal((await post({ text: 'stars', model: 'gpt-9' })).json.error, 'There is no model called "gpt-9".');
    assert.equal((await post({ text: 'stars', model: 7 })).status, 400);
    const chosen = await post({ text: 'stars over the arches', model: 'sketch' });
    assert.equal(chosen.status, 201);
    assert.deepEqual([chosen.json.idea.model, chosen.json.idea.by], ['sketch', 'Sketch']);
    const locked = (await post({ text: 'embers on the spires' })).json.idea;
    assert.equal(locked.model, 'sketch', 'a locked account\'s default is the free model');
    assert.equal((await admin.put(`/api/admin/people/${member.user.id}`, { unlocked: true })).status, 200);
    const plain = (await post({ text: 'embers on the spires' })).json.idea;
    assert.deepEqual([plain.model, plain.generator, plain.by], ['luna', 'luna', 'Luna']);
    assert.equal(queue.enqueued.at(-1).model, 'luna');
  });

  test('a long poll answers when the idea changes, at once when it already has, and never for others', async () => {
    const { idea } = (await member.post('/api/ideas', { text: 'a slow aurora', model: 'sketch' })).json;
    const seen = `${idea.status}@${idea.updatedAt}`, url = `/api/ideas/${idea.id}?wait=${encodeURIComponent(seen)}`;
    const t0 = Date.now();
    const waiting = member.get(url);
    await new Promise((r) => setTimeout(r, 150));
    queue.touch(idea.id, { status: 'generating' });
    const changed = await waiting;
    assert.equal(changed.json.idea.status, 'generating');
    assert.ok(Date.now() - t0 >= 150 && Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
    const stale = Date.now();
    assert.equal((await member.get(url)).json.idea.status, 'generating', 'what the client saw is old: at once');
    assert.ok(Date.now() - stale < 1000);
    assert.equal((await admin.get(url)).status, 404);
  });
});
