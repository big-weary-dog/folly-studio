// A PNG of a frame's rig pixels seen from the front (the simulator's snapshot): each LED a dot on black.
import { crc32, deflateSync } from 'node:zlib';

import type { prepareScene } from '../../public/js/pattern-core.ts';

type Scene = ReturnType<typeof prepareScene>;

function chunk(type: string, data: Buffer) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGB pixels (w × h × 3) as a PNG file. */
function encodePng(w: number, h: number, rgb: Uint8Array) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** The rig's LEDs from `channels` (as DDP carries them) drawn from the front, `h` pixels tall. */
export function frontView(scene: Scene, channels: Uint8Array, h = 640) {
  const span = (a: Float64Array) => Math.max(...a) - Math.min(...a) || 1;
  const pad = 8, inner = h - 2 * pad, w = Math.round(inner * span(scene.Z) / span(scene.Y)) + 2 * pad;
  const img = new Uint8Array(w * h * 3), [r, g, b] = scene.order;
  for (let k = 0; k < scene.count; k++) {
    const px = pad + Math.round(scene.z[k]! * (w - 2 * pad - 1));
    const py = pad + Math.round((1 - scene.y[k]!) * (inner - 1));
    const a = scene.addr[k]!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const o = ((py + dy) * w + px + dx) * 3;
        img[o] = Math.max(img[o]!, channels[a + r!]!);
        img[o + 1] = Math.max(img[o + 1]!, channels[a + g!]!);
        img[o + 2] = Math.max(img[o + 2]!, channels[a + b!]!);
      }
    }
  }
  return encodePng(w, h, img);
}
