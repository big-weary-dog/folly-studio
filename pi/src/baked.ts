// Baked frames on the lights (SPEC-offline "Playing on the lights"): a look's bake as Studio stored it
// (<frames>/<lookId>.fseq), read off the frame loop in slices, held to the SHA-256 Studio sent, parsed strictly and
// mapped onto the rig's LEDs, so each frame fills the engine's colours as a rendered look would. The bytes are the
// look's colour (as a bake writes them); the engine's light transform, fades and flash guard follow as for any look.
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';

import type { Scene } from '../../public/js/pattern-core.ts';
import { parseFseq } from '../../src/frames.ts';

const MAX_BAKE_BYTES = 128 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,64}$/, SLICE = 1 << 20;

export type Baked = { frames: number, duration: number, fill(frame: number, rgb: Float32Array): void };

/** Reads and checks `<dir>/<id>.fseq`; throws, saying why, if it cannot play. */
export async function loadBaked(dir: string, id: string, sha256: string, scene: Scene): Promise<Baked> {
  if (!dir) throw new Error('the engine has no frames folder (its frames setting)');
  if (!ID.test(id)) throw new Error('not a look id');
  const fh = await open(path.join(dir, `${id}.fseq`)).catch(() => { throw new Error('its bake is not there'); });
  let bytes: Uint8Array;
  try {
    const { size } = await fh.stat();
    if (size > MAX_BAKE_BYTES) throw new Error(`its bake is over ${MAX_BAKE_BYTES >> 20} MB`);
    bytes = new Uint8Array(size);
    const hash = createHash('sha256');
    // A slice at a time, so the frame loop runs between them.
    for (let at = 0; at < size;) {
      const { bytesRead } = await fh.read(bytes, at, Math.min(SLICE, size - at), at);
      if (!bytesRead) throw new Error('its bake was cut short');
      hash.update(bytes.subarray(at, at + bytesRead));
      at += bytesRead;
    }
    if (hash.digest('hex') !== sha256) throw new Error('its bake changed since it was queued');
  } finally {
    await fh.close();
  }
  const p = parseFseq(bytes, { maxBytes: MAX_BAKE_BYTES, maxChannels: scene.frameChannels });
  if (Math.abs(p.fps - scene.fps) > 0.01) throw new Error(`baked at ${p.fps} fps; the rig plays ${scene.fps}`);
  // Each LED colour's place in a frame's channels, -1 where the bake has none (dark).
  const where = new Int32Array(scene.frameChannels).fill(-1);
  let o = 0;
  for (const [start, count] of p.ranges) for (let i = 0; i < count; i++) where[start + i] = o++;
  const at = new Int32Array(scene.count * 3);
  for (let k = 0; k < scene.count; k++) {
    for (let c = 0; c < 3; c++) at[3 * k + c] = where[scene.addr[k]! + scene.order[c]!] ?? -1;
  }
  const { data, channelCount, frameCount } = p;
  return {
    frames: frameCount, duration: frameCount / scene.fps,
    fill(frame, rgb) {
      const base = (frame % frameCount) * channelCount;
      for (let i = 0; i < at.length; i++) rgb[i] = at[i]! < 0 ? 0 : data[base + at[i]!]! / 255;
    },
  };
}
