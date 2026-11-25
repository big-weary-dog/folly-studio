// What could not be made is not retried at once, and is retried after a while (src/failures.ts).
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { createFailures } from '../src/failures.ts';

test('a failure holds for retryMs, then lets the key be tried again', () => {
  let t = 0;
  const failed = createFailures({ retryMs: 1000, now: () => t });
  assert.equal(failed.has('a'), false);
  failed.add('a');
  t = 999;
  assert.equal(failed.has('a'), true);
  failed.add('b');
  t = 1000;
  assert.equal(failed.has('a'), false, 'tried again');
  assert.equal(failed.has('b'), true);
  t = 2000;
  failed.add('c'); // and the expired go as new ones come
  assert.equal(failed.has('b'), false);
});
