// What a model is shown of the frames it made (SPEC-generators "Critique"): the LEDs seen from the front (z across, y
// up, the back drawn first) at a few times, as small PNGs, and a line a second with each top-level group's mean colour
// and brightness, for models that read text only. Works on baked bytes from the render box; runs no look code.

import { crc32, deflateSync } from 'node:zlib';

import { pixelsForGroups, prepareScene } from '../../public/js/pattern-core.ts';
import type { Rig } from '../../shared/schemas/rig.ts';
import { parseFseq } from '../frames.ts';
import { inflateBlock } from '../fseq-codec.ts';

const WIDTH = 360;
type Parsed = ReturnType<typeof parseFseq>;
type Scene = ReturnType<typeof prepareScene>;

/** Each LED's R, G and B byte within a frame (−1 when the file does not hold it). */
function offsets(parsed: Parsed, scene: Scene) {
  const size = parsed.ranges.reduce((n, [s, c]) => Math.max(n, s + c), 0), where = new Int32Array(size).fill(-1);
  let off = 0;
  for (const [s, c] of parsed.ranges) for (let i = 0; i < c; i++) where[s + i] = off++;
  return scene.order.map((c) => Int32Array.from(scene.addr, (a) => (a >= 0 && a + c < size ? where[a + c]! : -1)));
}

function png(w: number, h: number, rgb: Uint8Array) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8), body = Buffer.concat([Buffer.from(type, 'latin1'), data]), crc = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head.subarray(0, 4), body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16)
  .padStart(2, '0')).join('')}`;

/**
 * Baked frames → { stills: PNG per time in `at` (seconds), timeline: text, a line a second }. Throws when the bytes
 * are not frames of this rig.
 */
export function viewFrames(bytes: Uint8Array, rig: Rig, { at = [1, 4, 7], stills = true } = {}) {
  const scene = prepareScene(rig);
  const parsed = parseFseq(bytes, { maxChannels: scene.frameChannels, decompress: inflateBlock });
  const [oR, oG, oB] = offsets(parsed, scene) as [Int32Array, Int32Array, Int32Array];
  const { data, channelCount: cc, frameCount: F, stepMs } = parsed, N = scene.count;
  const frameAt = (s: number) => Math.min(F - 1, Math.max(0, Math.round((s * 1000) / stepMs)));
  const rgb = (f: number, k: number) => [oR, oG, oB].map((o) => (o[k]! >= 0 ? data[f * cc + o[k]!]! : 0));
  const { min, max } = scene.bounds, spanZ = max[2]! - min[2]! || 1, spanY = max[1]! - min[1]! || 1;
  const W = WIDTH, H = Math.max(40, Math.min(WIDTH, Math.round((W * spanY) / spanZ)));
  const order = [...Array(N).keys()].sort((a, b) => scene.X[b]! - scene.X[a]!); // the back first, the front on top
  const pictures = !stills ? [] : at.map((s) => {
    const img = new Uint8Array(W * H * 3), f = frameAt(s);
    for (const k of order) {
      const x = 1 + Math.round(((scene.Z[k]! - min[2]!) / spanZ) * (W - 3));
      const y = H - 2 - Math.round(((scene.Y[k]! - min[1]!) / spanY) * (H - 3));
      const c = rgb(f, k);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = ((y + dy) * W + x + dx) * 3;
          for (let ch = 0; ch < 3; ch++) img[i + ch] = Math.max(img[i + ch]!, c[ch]!);
        }
      }
    }
    return { at: s, png: png(W, H, img) };
  });
  // The root's children (or the root), each a mean colour and brightness (0–100 % of white) a second.
  const tops = scene.groups.filter((g) => g.parent === scene.root?.id);
  const parts = (tops.length ? tops : scene.root ? [scene.root] : []).slice(0, 8)
    .map((g) => ({ id: g.id, px: pixelsForGroups(scene, g.id) })).filter((p) => p.px.length);
  const lines: string[] = [];
  for (let s = 0; s < Math.min(30, (F * stepMs) / 1000); s++) {
    const f = frameAt(s + 0.5);
    lines.push(`${s}s ${parts.map(({ id, px }) => {
      const sum = [0, 0, 0];
      for (const k of px) rgb(f, k).forEach((v, ch) => { sum[ch]! += v; });
      const [r, g, b] = sum.map((v) => v / px.length) as [number, number, number];
      return `${id} ${hex(r, g, b)} ${Math.round(((r + g + b) / 765) * 100)}%`;
    }).join(', ')}`);
  }
  return { stills: pictures, timeline: lines.join('\n') };
}
