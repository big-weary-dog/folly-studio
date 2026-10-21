// PUT /api/me/tour: the tutorial's progress kept on the account, bounded, and returned with the user.
import assert from 'node:assert/strict';
import path from 'node:path';

import { afterAll, beforeAll, test } from 'vitest';

import { client, fx, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
let app;
beforeAll(async () => { app = await startApp({ dataDir: path.join(fx.tmp, 'data-tour') }); });
afterAll(() => app.close());

test('the tour is saved on the account and comes back with it', async () => {
  const c = await signup(app, 'tourist');
  assert.equal((await c.get('/api/me')).json.user.tour, undefined, 'a new account has not seen it');
  const tour = { seen: true, done: ['first-look'], at: { path: 'layers', step: 'blend' } };
  const r = await c.put('/api/me/tour', tour);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.tour, tour);
  assert.deepEqual((await c.get('/api/me')).json.user.tour, tour);
  const again = client(app);
  assert.deepEqual((await again.post('/api/login', { username: 'tourist', password: 'correct horse' })).json.user.tour,
    tour, 'on another device too');
});

test('a tour that is not one is refused', async () => {
  const c = await signup(app, 'tourist-2');
  for (const bad of [{ seen: false, done: [] }, { seen: true, done: ['<b>'] }, { seen: true, done: [], extra: 1 },
    { seen: true, done: Array.from({ length: 17 }, (_, i) => `p${i}`) }]) {
    assert.equal((await c.put('/api/me/tour', bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await client(app).put('/api/me/tour', { seen: true, done: [] })).status, 401);
});
