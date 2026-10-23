import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import { test } from 'vitest';

import { engineOutput } from './fixtures/engine-output.js';

test('relay stats stay complete when stdout splits a line at the fps or relay fields', async () => {
  const stream = new PassThrough(), output = engineOutput(stream);
  stream.write('control page on http://127.0.0.1:1234\n');
  await output.ready;
  stream.write('safe t 0.0s | 40.0 fps,');
  stream.write(' render 0.1 ms | gen 0 W | relay cara ');
  assert.equal(output.stats().relay, null, 'an unfinished record is not published');
  stream.write('on, ahead 8, missed 2\n');
  assert.deepEqual(output.stats(), { relay: { by: 'cara', on: true, missed: 2 }, watts: 0 });
  stream.write('safe t 1.0s | 40.0 fps, render 0.1 ms | gen 50 W\n');
  assert.deepEqual(output.stats(), { relay: null, watts: 50 }, 'a complete record without a relay releases it');
  stream.end();
});
