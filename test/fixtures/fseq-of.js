// A bake's FSEQ made by hand, for the frame checks' tests.
import { ledRanges, writeFseq } from '../../core/fseq.ts';
import { prepareScene } from '../../core/pattern-core.ts';

/** `seconds` at 40 fps on `rig`: colour(f, k) → LED k's [r, g, b] (0..255) in frame f, in the rig's channel order.
 * Sparse over the rig's LEDs, or `full`: every channel of the universes they use. */
export function fseqOf(rig, seconds, colour, { full = false } = {}) {
  const scene = prepareScene(rig), frames = Math.round(seconds * 40), cpu = rig.output.channelsPerUniverse;
  const ranges = full ? null : ledRanges(rig);
  const cc = full ? Math.ceil((Math.max(...scene.addr) + 3) / cpu) * cpu : ranges.reduce((n, r) => n + r[1], 0);
  const at = new Int32Array(scene.frameChannels).fill(-1);
  if (full) for (let i = 0; i < cc; i++) at[i] = i;
  else for (let o = 0, r = 0; r < ranges.length; r++) for (let i = 0; i < ranges[r][1]; i++) at[ranges[r][0] + i] = o++;
  const data = new Uint8Array(frames * cc);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < scene.count; k++) {
      const c = colour(f, k);
      for (let i = 0; i < 3; i++) data[f * cc + at[scene.addr[k] + scene.order[i]]] = c[i];
    }
  }
  return writeFseq({ frames, data, ...(full ? { channelCount: cc } : { ranges }) });
}
