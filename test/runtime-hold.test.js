// The live runtime while baked playback has the picture: a live reply on its way is dropped and asks for no next
// frame, until the live preview pumps again; and the frame buffers it hands back for the worker to fill.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { Runtime } from '../public/js/runtime.ts';

test('hold drops the reply in flight and stops the live frames until a pump', () => {
  const shown = [], asked = [];
  const rt = new Runtime({ time: () => 0.5, onFrame: (rgb) => shown.push(rgb),
    onCompiled() {}, onFrameErrors() {}, onStatus() {} });
  clearInterval(rt.watchdog);
  Object.assign(rt, { phase: 'ready', _post: (m) => { if (m.type === 'frame') asked.push(m.seq); } });
  const reply = () => rt._frame({ type: 'frame', seq: rt.seq, rgb: new Float32Array(3), errors: [] },
    rt.frameInFlight);
  rt.pump(0, true);
  rt.hold();
  rt.due = 0;
  reply();
  assert.deepEqual([shown.length, asked.length], [0, 1], 'nothing shown, nothing more asked');
  rt.pump(0, true);
  reply();
  assert.equal(shown.length, 1, 'live again');
});

test('a frame request hands back only a buffer nothing shows: the one before the shown, or one never shown', () => {
  const shown = [], lent = [];
  const rt = new Runtime({ time: () => 0.5, onFrame: (rgb) => shown.push(rgb),
    onCompiled() {}, onFrameErrors() {}, onStatus() {} });
  clearInterval(rt.watchdog);
  Object.assign(rt, { phase: 'ready', _post: (m) => { if (m.type === 'frame') lent.push(m.rgb); } });
  const reply = (rgb) => { rt._frame({ type: 'frame', seq: rt.seq, rgb, errors: [] }, rt.frameInFlight); rt.due = 0; };
  const [a, b, c, d] = [1, 2, 3, 4].map(() => new Float32Array(3));
  rt.pump(0, false);
  reply(a);
  rt.pump(1, false);
  reply(b);
  rt.pump(2, false);
  assert.deepEqual(lent, [undefined, undefined, a], 'a, once b is shown');
  rt.hold();
  reply(c);
  rt.pump(3, false);
  assert.equal(lent[3], c, 'c, never shown; b stays');
  reply(d);
  rt.pump(4, false);
  assert.equal(lent[4], b);
  assert.equal(rt.frameMsg.rgb, undefined, 'the reused message keeps no buffer');
  assert.deepEqual(shown, [a, b, d]);
});
