// An idea's states (shared/idea-status.ts): what counts as pending, the legal moves, and the queue refusing the rest.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { IDEA_STATUS, IllegalMove, isPending, transition } from '../shared/idea-status.ts';
import { createQueue } from '../src/generate/index.ts';
import { queueSetup } from './fixtures/generate/shared.js';

describe('idea states', () => {
  test('pending: queued or generating', () => {
    assert.deepEqual(Object.keys(IDEA_STATUS).filter((s) => isPending({ status: s })), ['queued', 'generating']);
  });

  test('the moves: forward, generating again after a restart, queued again when interrupted; ready and failed final',
    () => {
      const ok = [['queued', 'generating'], ['queued', 'failed'], ['generating', 'generating'],
        ['generating', 'queued'], ['generating', 'ready'], ['generating', 'failed']];
      for (const [from, to] of ok) {
        assert.deepEqual(transition({ status: from }, to as never, { error: null }), { error: null, status: to });
      }
      for (const [from, to] of [['queued', 'ready'], ['ready', 'generating'], ['failed', 'ready'], ['ready', 'failed'],
        ['interrupted', 'queued']]) {
        assert.throws(() => transition({ id: 'i1', status: from }, to as never), IllegalMove, `${from} → ${to}`);
      }
    });

  test('the queue makes no illegal move: a failed idea enqueued again stays failed', async () => {
    let calls = 0;
    const { store, user, queue } = queueSetup(createQueue, { adapters: { sketch: async () => { calls++; } } });
    const i = store.ideas.create({ owner: user.id, text: 'a tide', status: 'failed', generator: 'sketch',
      error: 'boom' });
    queue.enqueue(i);
    await queue.idle();
    assert.deepEqual([store.ideas.get(i.id).status, store.ideas.get(i.id).error], ['failed', 'boom']);
    assert.equal(calls, 0);
  });
});
