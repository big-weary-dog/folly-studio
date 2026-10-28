// A PNG of a frame's rig pixels seen from the front (the simulator's snapshot): each LED a dot on black.
import { encodePng } from '../../src/png.ts';

import type { prepareScene } from '../../public/js/pattern-core.ts';

type Scene = ReturnType<typeof prepareScene>;

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
