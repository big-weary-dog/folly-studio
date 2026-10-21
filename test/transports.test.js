// What each transport may do (TRANSPORT_CAPS, shared/schemas/models.ts): every transport has a row and a module, and
// the API and the queue agree on it: the API takes an idea's explore level, a refinement and a critique exactly where
// the queue explores, refines and lets the model look. The queue's adapters are stand-ins; no model is called.
import assert from 'node:assert/strict';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { cannot, TRANSPORT_CAPS, TRANSPORTS } from '../shared/schemas/models.ts';
import { ADAPTERS } from '../src/generate/adapters.ts';
import { createQueue } from '../src/generate/index.ts';
import { FIX, goodLayer, queueSetup } from './fixtures/generate/shared.js';
import { fakeQueue, fx, PIXEL, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const MODELS = { claude: 'opus', codex: 'sol', fleet: 'deep' };

describe('transport capabilities', () => {
  test('every transport has a row and a module, and nothing else does', () => {
    assert.deepEqual(Object.keys(TRANSPORT_CAPS).sort(), [...TRANSPORTS].sort());
    assert.deepEqual(Object.keys(ADAPTERS).sort(), [...TRANSPORTS].sort());
    for (const t of TRANSPORTS) {
      assert.equal(typeof ADAPTERS[t].create, 'function', t);
      assert.equal(typeof ADAPTERS[t].probe, 'function', t);
      if (TRANSPORT_CAPS[t].explores || TRANSPORT_CAPS[t].critiques) assert.ok(TRANSPORT_CAPS[t].prompted, t);
    }
  });

  describe('the API and the queue agree', () => {
    let app, ana, look;
    const queue = fakeQueue();
    beforeAll(async () => {
      app = await startApp({ dataDir: path.join(fx.tmp, 'data-transports'), generator: queue, admins: 'ana',
        models: { env: { ANTHROPIC_API_KEY: 'not-a-key', STUDIO_FOUNDRY: 'on', PATH: path.join(FIX, 'bin') } } });
      ana = await signup(app, 'ana');
      const { config } = (await ana.get('/api/admin/models')).json;
      const deep = { id: 'deep', label: 'Deep', via: 'fleet', enabled: true };
      assert.equal((await ana.put('/api/admin/models', { ...config, models: [...config.models, deep] })).status, 200);
      look = (await ana.post('/api/looks', { title: 'Tide', layers: [{ code: PIXEL }], chain: 2 })).json.look;
    });
    afterAll(() => app?.close());

    /** What the API does with each ask on `via`'s model: the idea's explore level kept, a refinement and a critique
     * taken. */
    async function api(via) {
      const model = MODELS[via];
      const idea = await ana.post('/api/ideas', { text: 'a tide rising', model, explore: 'explore' });
      assert.equal(idea.status, 201, idea.text);
      const refine = await ana.post(`/api/looks/${look.id}/refine`, { text: 'slower', model });
      if (refine.status === 201) await app.store.ideas.update(refine.json.idea.id, { status: 'ready' });
      const critique = await ana.post(`/api/looks/${look.id}/refine`, { critique: true, model });
      if (critique.status === 201) await app.store.ideas.update(critique.json.idea.id, { status: 'ready' });
      return { explores: idea.json.idea.explore === 'explore', refines: refine.status === 201,
        critiques: critique.status === 201 };
    }

    /** What the queue does on `via`'s lane: whether it explores (its first call asks for the draft turn's schema)
     * and refines (no "cannot refine"). */
    async function queued(via) {
      const first = [];
      const adapter = async (ctx) => { first.push(ctx); throw new Error('a stand-in'); };
      const { store, user, queue: q } = queueSetup(createQueue, { adapterName: via, adapters: { [via]: adapter },
        foundry: { on: true, memoryCap: async () => true } });
      const made = store.looks.create({ owner: user.id, title: 'Tide', layers: [goodLayer()] });
      const explored = store.ideas.create({ owner: user.id, text: 'a tide rising', status: 'queued', explore: 'explore',
        model: via });
      q.enqueue(explored);
      await q.idle();
      const refined = store.ideas.create({ owner: user.id, text: 'slower', status: 'queued', model: via,
        lookId: made.id, refine: {} });
      q.enqueue(refined);
      await q.idle();
      return { explores: !!first[0]?.schema, refines: !/cannot refine/.test(store.ideas.get(refined.id).error ?? '') };
    }

    for (const via of TRANSPORTS) {
      test(via, async () => {
        const caps = TRANSPORT_CAPS[via], said = await api(via), done = await queued(via);
        assert.deepEqual(said, { explores: caps.explores, refines: caps.refines, critiques: caps.critiques });
        assert.deepEqual(done, { explores: caps.explores, refines: caps.refines });
        assert.equal(cannot({ via, label: 'M' }, { critique: true }) === null, caps.critiques);
      });
    }
  });
});
