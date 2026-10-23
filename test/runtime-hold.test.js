// The live runtime while baked playback has the picture: a live reply on its way is dropped and asks for no next
// frame, until the live preview pumps again.
import assert from 'node:assert/strict';

import { afterEach, test, vi } from 'vitest';

import { Runtime } from '../public/js/runtime.ts';

afterEach(() => vi.unstubAllGlobals());

test('hold drops the reply in flight and stops the live frames until a pump', () => {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  const shown = [], asked = [];
  const rt = new Runtime({ container: null, time: () => 0.5, onFrame: (rgb) => shown.push(rgb),
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
