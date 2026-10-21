// POST /api/looks/:id/refine (SPEC "HTTP API", SPEC-generators "Refine"): one's own look only, an idea of its own on
// the queue (one use), one at a time per look, the foundry never asked to refine;
// refinements stay off the ideas page's list only in the browser (the API lists every idea); a finished one undone.
import assert from 'node:assert/strict';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { FIX } from './fixtures/generate/shared.js';
import { fakeQueue, fx, PIXEL, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();

describe('refine API', () => {
  let app, ana, bo, queue, look;
  beforeAll(async () => {
    queue = fakeQueue();
    app = await startApp({ dataDir: path.join(fx.tmp, 'data-refine'), generator: queue, admins: 'ana',
      models: { env: { STUDIO_FOUNDRY: 'on', PATH: path.join(FIX, 'bin') } } });
    ana = await signup(app, 'ana');
    bo = await signup(app, 'bob');
    look = (await ana.post('/api/looks', { title: 'Tide', layers: [{ code: PIXEL }], chain: 2 })).json.look;
  });
  afterAll(() => app?.close());

  test('a request, a critique or a fix; checked first', async () => {
    assert.equal((await ana.post(`/api/looks/${look.id}/refine`, { text: 'x' })).status, 400);
    assert.match((await ana.post(`/api/looks/${look.id}/refine`, {})).json.error, /Describe the change/);
    assert.equal((await bo.post(`/api/looks/${look.id}/refine`, { text: 'slower' })).status, 404, 'not bob\'s');
    assert.equal((await ana.post('/api/looks/nope/refine', { text: 'slower' })).status, 404);
    const { config } = (await ana.get('/api/admin/models')).json;
    const deep = { id: 'deep', label: 'Deep', via: 'fleet', enabled: true };
    assert.equal((await ana.put('/api/admin/models', { ...config, models: [...config.models, deep] })).status, 200);
    const fleet = await ana.post(`/api/looks/${look.id}/refine`, { text: 'slower', model: 'deep' });
    assert.deepEqual([fleet.status, fleet.json.error], [400, 'Deep cannot refine a look; pick another model.']);
    assert.equal(queue.enqueued.length, 0);
  });

  test('queued as an idea on the look, then 409 until it is done', async () => {
    const r = await ana.post(`/api/looks/${look.id}/refine`, { text: 'slower', fix: { layer: 'L', error: 'boom' } });
    assert.equal(r.status, 201, r.text);
    assert.deepEqual([r.json.idea.lookId, r.json.idea.model, r.json.idea.status, r.json.idea.refine],
      [look.id, 'sol', 'queued', { fix: { layer: 'L', error: 'boom' } }]);
    assert.deepEqual(queue.enqueued.map((i) => i.id), [r.json.idea.id]);
    const again = await ana.post(`/api/looks/${look.id}/refine`, { text: 'faster' });
    assert.equal(again.status, 409);
    await app.store.ideas.update(r.json.idea.id, { status: 'ready' });
    assert.equal((await ana.post(`/api/looks/${look.id}/refine`, { text: 'faster' })).status, 201);
    assert.equal((await ana.get('/api/ideas')).json.ideas.filter((i) => i.refine).length, 2);
  });

  test('a finished refinement is undone by its owner only', async () => {
    const mine = (await ana.get('/api/ideas')).json.ideas.filter((i) => i.refine);
    const done = mine.find((i) => i.status === 'ready'), pending = mine.find((i) => i.status === 'queued');
    assert.equal((await ana.post(`/api/ideas/${pending.id}/undo`)).status, 409);
    assert.equal((await bo.post(`/api/ideas/${done.id}/undo`)).status, 404);
    const r = await ana.post(`/api/ideas/${done.id}/undo`);
    assert.deepEqual([r.status, r.json.idea.undone], [200, true]);
  });
});
