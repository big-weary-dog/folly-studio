// Deleting an account waits for its looks to be counted, so the confirm can say what goes (spec/http "Your account").
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { deleting } from '../public/js/ui/account/delete.ts';

test('Delete waits while the looks are counted, and stays off when they cannot be', () => {
  assert.deepEqual(deleting(null, 'ann'), { ready: false, note: 'Counting your looks…' });
  const failed = deleting({ error: 'Could not reach the server.' }, 'ann');
  assert.equal(failed.ready, false);
  assert.match(failed.note, /could not be counted \(Could not reach the server\.\)/);
  assert.equal('question' in failed, false);
});

test('once counted, the confirm names the looks and the shared ones', () => {
  assert.deepEqual(deleting({ all: 2, shared: 1 }, 'ann'), { ready: true, note: '2 looks, 1 shared',
    question: 'Delete the account ann and its 2 looks (1 shared in the gallery)? This cannot be undone.' });
  assert.deepEqual(deleting({ all: 1, shared: 0 }, 'ann').question,
    'Delete the account ann and its 1 look? This cannot be undone.');
  assert.deepEqual(deleting({ all: 0, shared: 0 }, 'ann'), { ready: true, note: 'no looks',
    question: 'Delete the account ann? This cannot be undone.' });
});
