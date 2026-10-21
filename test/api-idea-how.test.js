// How an idea was made (src/api-idea-how.ts, SPEC-generators "How it was made"): its owner and admins only (404 for
// anyone else, curators too); the shared prompt to owners by size, errors and notes to admins; its stills; the
// summary the idea keeps once its log is gone; and what a round costs (prices.ts).
import assert from 'node:assert/strict';
import path from 'node:path';

import { describe, test } from 'vitest';

import { createQueue } from '../src/generate/index.ts';
import { costOf } from '../src/generate/prices.ts';
import { REAL } from './fixtures/generate/box.js';
import { fx, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const SYSTEM = 'You are the show designer.\n# The library\n- bars: stripes\n# Palettes\nember';
const TURN = [{ role: 'user', content: [{ type: 'text', text: 'The library docs for this idea (read_doc only for a '
  + 'page not here):\n\n<doc path="library/sources/bars.md">\n# bars\nStripes.\n</doc>' }, { type: 'text',
  text: '<idea>a slow tide</idea>' }] }];

describe('how an idea was made', () => {
  test('its owner and admins see it; anyone else, a curator too, gets 404', async () => {
    const dataDir = path.join(fx.tmp, 'data-idea-how');
    const claude = async (ctx) => {
      ctx.round?.call({ ms: 3, system: SYSTEM, turn: TURN, usage: { input: 900, cached: 600, output: 40 },
        reply: [{ type: 'thinking', thinking: 'A tide is slow: one wide swell.' }] });
      ctx.round?.still(PNG, { view: 'front', at: 1.3 });
      return { plan: 'One slow layer.', title: 'Tide', summary: 'A swell', layers: [{ title: 'Swell',
        groups: ['cathedral'], blend: 'add', level: 0.8, modules: [{ use: 'bars', params: [] }], why: 'a swell' }] };
    };
    const app = await startApp({ dataDir, admins: 'ada', curators: 'cora', generator: (deps) => createQueue({
      ...deps, adapterName: 'claude', adapters: { claude }, loadLibrary: () => REAL }) });
    try {
      const [owner, admin, other, curator] = await Promise.all(['otto', 'ada', 'olga', 'cora']
        .map((n) => signup(app, n)));
      const idea = app.store.ideas.create({ owner: owner.user.id, text: 'a slow tide', status: 'queued',
        generator: 'claude' });
      app.queue.enqueue(idea);
      await app.queue.idle();
      for (const c of [other, curator]) {
        assert.equal((await c.get(`/api/ideas/${idea.id}/how`)).status, 404);
        assert.equal((await c.get(`/api/ideas/${idea.id}/how/stills/1-compose-1.png`)).status, 404);
      }

      const mine = (await owner.get(`/api/ideas/${idea.id}/how`)).json;
      assert.equal(mine.from, 'log');
      assert.deepEqual(mine.prompt.map((p) => [p.name, typeof p.text]), [['The guide', 'undefined'],
        ['The library catalog', 'undefined'], ['library/sources/bars.md', 'string'], ['Your idea', 'string']]);
      assert.equal(mine.prompt[1].bytes, Buffer.byteLength('# The library\n- bars: stripes'));
      assert.equal(mine.prompt[3].text, '<idea>a slow tide</idea>');
      const [r] = mine.rounds;
      assert.deepEqual([r.kind, r.plan, r.thinking], ['compose', 'One slow layer.', 'A tide is slow: one wide swell.']);
      assert.deepEqual(r.changes, [{ text: '+ layer Swell (bars)', why: 'a swell' }]);
      assert.deepEqual(r.stills, [{ file: '1-compose-1.png', view: 'front', at: 1.3 }]);
      assert.ok(!('usd' in mine) && !('notes' in r) && !mine.run.name, 'no dollars or notes for owners');
      assert.ok(!mine.idea.how, 'the idea as its owner gets it');
      const still = await owner.get(`/api/ideas/${idea.id}/how/stills/1-compose-1.png`);
      assert.equal(still.status, 200);
      assert.equal((await owner.get(`/api/ideas/${idea.id}/how/stills/..%2Fidea.json`)).status, 400);

      const seen = (await admin.get(`/api/ideas/${idea.id}/how`)).json;
      assert.equal(seen.prompt[0].text, 'You are the show designer.\n\n# Palettes\nember');
      assert.equal(seen.prompt[1].text, '# The library\n- bars: stripes');

      // Once the log is gone, the summary the idea keeps; an idea from before has neither.
      const kept = app.store.ideas.create({ owner: owner.user.id, text: 'old', status: 'ready', generator: 'claude',
        how: [{ n: 1, kind: 'compose', ms: 5, outcome: 'failed: sk-secret', plan: 'p', stills: 2 }] });
      const back = (await owner.get(`/api/ideas/${kept.id}/how`)).json;
      assert.deepEqual([back.from, back.rounds[0].outcome, back.rounds[0].stills, back.prompt],
        ['idea', 'failed', 2, undefined]);
      const old = app.store.ideas.create({ owner: owner.user.id, text: 'older', status: 'ready', generator: 'claude' });
      assert.deepEqual((await owner.get(`/api/ideas/${old.id}/how`)).json.rounds, []);
      assert.equal((await owner.get('/api/ideas/nope/how')).status, 404);
    } finally {
      await app.close();
    }
  });

  test('a round\'s dollars: cached input at its own price; none for a model with no price', () => {
    assert.equal(costOf('claude-opus-5-5', { input: 1_000_000, cached: 500_000, output: 100_000 }), 2 + 0.1 + 2);
    assert.equal(costOf('claude-opus-5', { input: 1_000_000, cached: 0, output: 0 }), 5);
    assert.equal(costOf('gpt-6-luna', { input: 1, output: 1 }), undefined);
    assert.equal(costOf(undefined, { input: 1 }), undefined);
  });
});
