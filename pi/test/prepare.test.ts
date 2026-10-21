// pi/src/engine.ts prepares each look as it arrives, never in a frame: a switch, the queue going on, a look Studio
// sent and the flash guard's dip to safe all start what was prepared before.
import assert from 'node:assert/strict';

import { test, vi } from 'vitest';

import * as core from '../../public/js/pattern-core.ts';
import { FADE } from '../src/engine.ts';
import { engineOn, oneModule } from './fixture.ts';

vi.mock('../../public/js/pattern-core.ts', async (real) => {
  const mod = await real<typeof core>();
  return { ...mod, prepareLayer: vi.fn<typeof mod.prepareLayer>(mod.prepareLayer) };
});
const prepares = vi.mocked(core.prepareLayer);

test('no frame prepares a look: play, the queue, a sent look and the dip to safe were prepared before', () => {
  const r = engineOn([oneModule('strobe', 'strobe', { speed: 12 })]);
  let inFrames = 0;
  const run = (secs: number) => {
    const before = prepares.mock.calls.length;
    r.run(secs);
    inFrames += prepares.mock.calls.length - before;
  };
  r.engine.play('fire');
  run(1);
  assert.ok(r.engine.queue('beat-bars', 'now'));
  run(FADE.queue + 0.1);
  assert.equal(r.engine.state().look?.id, 'beat-bars');
  assert.ok(r.engine.send(oneModule('sent', 'colour-wash'), 'now'));
  run(FADE.queue + 0.1);
  assert.equal(r.engine.state().look?.id, 'sent');
  r.engine.play('strobe');
  run(4);
  assert.equal(r.engine.state().tripped?.look, 'strobe');
  assert.equal(r.engine.state().look?.id, 'safe');
  assert.ok(prepares.mock.calls.length > 0);
  assert.equal(inFrames, 0);
});
