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

/** A frame of DMX (the rig's channels), each LED's colour at its address in the rig's order, scaled, rounded to
 * 0..255: the colours as previewed (the LEDs' correction is correctChannels'). */
export function toChannels(scene: Scene, rgb: ArrayLike<number>, out?: Uint8Array | null,
  opts?: { brightness?: number }) {
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
      ch[base + order[c]] = Math.round(v * 255);
    }
  }
  return ch;
}

/** The LEDs' colour correction, the one place to tune it. Colours are sRGB (as on screen); LEDs are linear, so each
 * channel goes out as v^gamma (the Falcon's own gamma is None), then × its balance, which only trims a channel down:
 * brightness is the controller's per-port cap, never ours. */
export const OUTPUT_CORRECTION = { gamma: 2.2, balance: [1, 1, 1] };
export type OutputCorrection = typeof OUTPUT_CORRECTION;

/** A correction from untrusted settings: gamma 1..3, each balance 0..1, OUTPUT_CORRECTION where missing. */
export function correctionOf(c?: { gamma?: unknown, balance?: unknown } | null): OutputCorrection {
  const clamp = (v: unknown, lo: number, hi: number, d: number) => (isNum(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const b = Array.isArray(c?.balance) ? c.balance : [];
  return { gamma: clamp(c?.gamma, 1, 3, OUTPUT_CORRECTION.gamma),
    balance: OUTPUT_CORRECTION.balance.map((d, i) => clamp(b[i], 0, 1, d)) };
}

/** The correction as a table, 256 bytes per colour (r, g, b): built once, so a frame costs one lookup a channel. */
export function correctionTable(c: OutputCorrection) {
  const t = new Uint8Array(768);
  for (let k = 0; k < 3; k++) {
    for (let v = 0; v < 256; v++) t[256 * k + v] = Math.round((v / 255) ** c.gamma * c.balance[k] * 255);
  }
  return t;
}

/** A frame of channels (toChannels') corrected by `table` into `out` (in place by default), each LED's three
 * channels by their colour in the rig's order. */
export function correctChannels(scene: Scene, ch: Uint8Array, table: Uint8Array, out = ch) {
  const addr = scene.addr, order = scene.order, size = scene.frameChannels;
  if (out !== ch) out.set(ch.subarray(0, size));
  for (let k = 0; k < scene.count; k++) {
    const base = addr[k];
    if (base < 0 || base + 2 >= size) continue;
    for (let c = 0; c < 3; c++) out[base + order[c]] = table[256 * c + ch[base + order[c]]];
  }
  return out;
}
