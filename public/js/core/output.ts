// A frame's output: each layer's colours composited into the frame by its blend, and the frame as DMX channels in the
// rig's addresses and colour order.
import type { PreparedLayer } from './render.ts';
import type { Scene } from './scene.ts';
import { isNum } from './stdlib.ts';

/** Layer L's colours (L.buf, rgba) into rgb by its blend, at `level`. */
export function composite(rgb: Float32Array, L: PreparedLayer, level: number) {
  const idx = L.idx, m = idx.length, buf = L.buf;
  switch (L.blend) {
    case 'over':
      for (let j = 0; j < m; j++) {
        const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level, ia = 1 - a;
        for (let c = 0; c < 3; c++) rgb[o + c] = rgb[o + c] * ia + buf[q + c] * a;
      }
      break;
    case 'max':
      for (let j = 0; j < m; j++) {
        const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level;
        for (let c = 0; c < 3; c++) { const v = buf[q + c] * a; if (v > rgb[o + c]) rgb[o + c] = v; }
      }
      break;
    case 'multiply':
      for (let j = 0; j < m; j++) {
        const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level, ia = 1 - a;
        for (let c = 0; c < 3; c++) rgb[o + c] *= ia + buf[q + c] * a;
      }
      break;
    default: // add
      for (let j = 0; j < m; j++) {
        const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level;
        for (let c = 0; c < 3; c++) rgb[o + c] += buf[q + c] * a;
      }
  }
}

/** A frame of DMX (the rig's channels), each LED's colour at its address in the rig's order, scaled, gamma-bent,
 * rounded to 0..255. */
export function toChannels(scene: Scene, rgb: ArrayLike<number>, out?: Uint8Array | null,
  opts?: { gamma?: number, brightness?: number }) {
  const gamma = isNum(opts?.gamma) && opts.gamma > 0 ? opts.gamma : 1;
  const brightness = isNum(opts?.brightness) ? Math.max(0, opts.brightness) : 1;
  const size = scene.frameChannels;
  const ch = out && out.length >= size ? out : new Uint8Array(size);
  ch.fill(0, 0, size);
  const addr = scene.addr, N = scene.count, order = scene.order;
  for (let k = 0; k < N; k++) {
    const base = addr[k];
    if (base < 0 || base + 2 >= size) continue;
    for (let c = 0; c < 3; c++) {
      let v = rgb[3 * k + c] * brightness;
      v = v > 0 ? (v < 1 ? v : 1) : 0;
      if (gamma !== 1) v = Math.pow(v, gamma);
      ch[base + order[c]] = Math.round(v * 255);
    }
  }
  return ch;
}
