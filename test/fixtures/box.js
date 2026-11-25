// Stand-in render boxes (the real one is test/bake.test.js): what a box returns, without a box.
import { writeFseq } from '../../core/fseq.ts';

/** A box that always works, `render(job)` making its reply, `config.seconds` long at most; `renders` counts. */
export function stubBox(render, seconds = 2) {
  return {
    renders: 0,
    config: { seconds },
    probe: async () => ({ ok: true }),
    async render(job) {
      this.renders++;
      return render(job);
    },
  };
}

/** Two seconds of frames for the server fixture's two LEDs, strobing at 10 Hz when a module's params say strobe. */
export const fakeBox = () => stubBox(({ layers }) => {
  const strobe = layers.some((l) => l.modules?.some((m) => m.params?.strobe));
  const data = new Uint8Array(80 * 6);
  for (let f = 0; f < 80; f++) data.fill(strobe && Math.floor(f / 2) % 2 ? 0 : 200, f * 6, f * 6 + 6);
  return { bytes: Buffer.from(writeFseq({ frames: 80, data, ranges: [[0, 6]] })), boxStats: { untrusted: true,
    reported: { ok: true } } };
});
