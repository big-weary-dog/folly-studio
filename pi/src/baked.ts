// Baked frames on the lights (SPEC-offline "Playing on the lights"): a look's bake as Studio stored it
// (<frames>/<lookId>.fseq), read off the frame loop in slices, held to the SHA-256 Studio sent, parsed strictly and
// mapped onto the rig's LEDs, so each frame fills the engine's colours as a rendered look would. The bytes are the
// look's colour (as a bake writes them); the engine's light transform, fades and flash guard follow as for any look.
import { createHash } from 'node:crypto';
import { readSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

import type { Scene } from '../../public/js/pattern-core.ts';
import { parseFseqHeader } from '../../src/frames.ts';

const ID = /^[A-Za-z0-9_-]{1,64}$/, SLICE = 1 << 20;

export type Baked = { frames: number, duration: number, fill(frame: number, rgb: Float32Array): void,
  close?(): void };

/** Reads and checks `<dir>/<id>.fseq`; throws, saying why, if it cannot play. */
export async function loadBaked(dir: string, id: string, sha256: string, scene: Scene): Promise<Baked> {
  if (!dir) throw new Error('the engine has no frames folder (its frames setting)');
  if (!ID.test(id)) throw new Error('not a look id');
  const maxBytes = Math.ceil(600 * scene.fps * scene.frameChannels) + SLICE;
  const fh = await open(path.join(dir, `${id}.fseq`)).catch(() => { throw new Error('its bake is not there'); });
  try {
    const { size } = await fh.stat();
    if (size > maxBytes) throw new Error(`its bake is over ${maxBytes >> 20} MB`);
    const bytes = new Uint8Array(Math.min(SLICE, size));
    const { bytesRead: headSize } = await fh.read(bytes, 0, bytes.length, 0);
    const p = parseFseqHeader(bytes.subarray(0, headSize), { fileBytes: size, maxBytes,
      maxChannels: scene.frameChannels });
    if (p.frameCount > 600 * scene.fps) throw new Error('its bake is over 600 seconds');
    if (Math.abs(p.fps - scene.fps) > 0.01) throw new Error(`baked at ${p.fps} fps; the rig plays ${scene.fps}`);
    const hash = createHash('sha256');
    // A slice at a time, so the frame loop runs between them.
    for (let at = 0; at < size;) {
      const { bytesRead } = await fh.read(bytes, 0, Math.min(SLICE, size - at), at);
      if (!bytesRead) throw new Error('its bake was cut short');
      hash.update(bytes.subarray(0, bytesRead));
      at += bytesRead;
    }
    if (hash.digest('hex') !== sha256) throw new Error('its bake changed since it was queued');
    return reader(fh, p, scene);
  } catch (err) { await fh.close(); throw err; }
}

function reader(fh: FileHandle, p: ReturnType<typeof parseFseqHeader>, scene: Scene): Baked {
  // Each LED colour's place in a frame's channels, -1 where the bake has none (dark).
  const where = new Int32Array(scene.frameChannels).fill(-1);
  let o = 0;
  for (const [start, count] of p.ranges) for (let i = 0; i < count; i++) where[start + i] = o++;
  const at = new Int32Array(scene.count * 3);
  for (let k = 0; k < scene.count; k++) {
    for (let c = 0; c < 3; c++) at[3 * k + c] = where[scene.addr[k]! + scene.order[c]!] ?? -1;
  }
  const { channelCount, frameCount, dataOffset } = p;
  const data = new Uint8Array(channelCount);
  let closed = false;
  return {
    frames: frameCount, duration: frameCount / scene.fps,
    close() { if (!closed) { closed = true; void fh.close(); } },
    fill(frame, rgb) {
      if (closed) throw new Error('its bake is closed');
      const base = dataOffset + (frame % frameCount) * channelCount;
      for (let n = 0; n < data.length;) {
        const read = readSync(fh.fd, data, n, data.length - n, base + n);
        if (!read) throw new Error('its bake was cut short');
        n += read;
      }
      for (let i = 0; i < at.length; i++) rgb[i] = at[i]! < 0 ? 0 : data[at[i]!]! / 255;
    },
  };
}
