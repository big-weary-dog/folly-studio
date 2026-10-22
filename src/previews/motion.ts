// A look's gallery preview from its baked frames (SPEC "Gallery previews"): the LEDs' colours, sampled at FPS, over
// the WINDOW_S seconds that move the most (mean change from one sample to the next, plus a little brightness so a
// dark stretch loses), made to loop. A camera turns each sample into a picture: the Playa view's (./playa.ts) or,
// without a browser, frontView's (the LEDs from the front, as the critique's stills are). Runs no look code.

import { prepareScene } from '../../public/js/pattern-core.ts';
import type { Rig } from '../../shared/schemas/rig.ts';
import { parseFseq } from '../frames.ts';
import { inflateBlock } from '../fseq-codec.ts';

export const WINDOW_S = 5;
const FADE_S = 0.5;
export const WIDTH = 260;
export const HEIGHT = 228;
const TARGET_FPS = 13;
const BRIGHTNESS_WEIGHT = 0.1;

export type Loop = 'fade' | 'crossfade';
/** Samples (each LED's R, G, B in rig order) → pictures (RGB, width × height each). */
export type Camera = (rig: Rig, samples: Uint8Array[]) => Promise<{ width: number, height: number,
  pictures: Uint8Array[] }>;
export type Motion = { width: number, height: number, delayMs: number, frames: Uint8Array[], still: Uint8Array,
  start: number, seconds: number };

/** Each LED's R, G and B byte within a frame (−1 when the file does not hold it). */
function offsets(parsed: ReturnType<typeof parseFseq>, scene: ReturnType<typeof prepareScene>) {
  const size = parsed.ranges.reduce((n, [s, c]) => Math.max(n, s + c), 0), where = new Int32Array(size).fill(-1);
  let off = 0;
  for (const [s, c] of parsed.ranges) for (let i = 0; i < c; i++) where[s + i] = off++;
  return scene.order.map((c) => Int32Array.from(scene.addr, (a) => (a >= 0 && a + c < size ? where[a + c]! : -1)));
}

/** The best `n`-sample window's first sample, by mean change (`d[i]`: sample i against i−1) and brightness. */
export function bestWindow(change: Float64Array, bright: Float64Array, n: number) {
  const last = Math.max(0, bright.length - n);
  let best = 0, bestScore = -1, d = 0, b = 0;
  for (let i = 0; i < Math.min(n, bright.length); i++) { d += i ? change[i]! : 0; b += bright[i]!; }
  for (let s = 0; s <= last; s++) {
    if (s) { d += (change[s + n - 1] ?? 0) - change[s]!; b += (bright[s + n - 1] ?? 0) - bright[s - 1]!; }
    const score = (d / Math.max(1, n - 1)) + (BRIGHTNESS_WEIGHT * b) / n;
    if (score > bestScore + 1e-12) [best, bestScore] = [s, score];
  }
  return best;
}

/**
 * Baked frames → the window's samples: `n` to show, then (for a crossfade) `tail` more that run on past it, and
 * the still's (the window's brightest). Throws when the bytes are not frames of this rig.
 */
function pickWindow(bytes: Uint8Array, rig: Rig, loop: Loop) {
  const scene = prepareScene(rig);
  const parsed = parseFseq(bytes, { maxChannels: scene.frameChannels, decompress: inflateBlock });
  const [oR, oG, oB] = offsets(parsed, scene) as [Int32Array, Int32Array, Int32Array];
  const { data, channelCount: cc, frameCount: F, stepMs } = parsed, N = scene.count;
  const step = Math.max(1, Math.round(1000 / TARGET_FPS / stepMs)), delayMs = step * stepMs;
  const count = Math.floor((F - 1) / step) + 1, perSecond = 1000 / delayMs;
  const fade = Math.max(1, Math.round(FADE_S * perSecond));
  const tail = loop === 'crossfade' ? fade : 0;
  const n = Math.max(1, Math.min(count - tail, Math.round(WINDOW_S * perSecond)));
  const sample = (s: number) => {
    const out = new Uint8Array(N * 3), f = s * step * cc;
    for (let k = 0; k < N; k++) {
      out[3 * k] = oR[k]! >= 0 ? data[f + oR[k]!]! : 0;
      out[3 * k + 1] = oG[k]! >= 0 ? data[f + oG[k]!]! : 0;
      out[3 * k + 2] = oB[k]! >= 0 ? data[f + oB[k]!]! : 0;
    }
    return out;
  };

  // Each sample's mean brightness and change from the one before (0–1).
  const change = new Float64Array(count), bright = new Float64Array(count);
  let prev: Uint8Array | null = null;
  for (let s = 0; s < count; s++) {
    const cur = sample(s);
    let sum = 0, diff = 0;
    for (let i = 0; i < cur.length; i++) { sum += cur[i]!; if (prev) diff += Math.abs(cur[i]! - prev[i]!); }
    bright[s] = sum / (N * 3 * 255);
    change[s] = diff / (N * 3 * 255);
    prev = cur;
  }
  // The tail a crossfade blends in must follow the window, so the window ends `tail` samples early.
  const start = bestWindow(change, bright.subarray(0, count - tail), n);
  let brightest = start;
  for (let s = start; s < start + n; s++) if (bright[s]! > bright[brightest]!) brightest = s;
  const samples = Array.from({ length: Math.min(count - start, n + tail) }, (_, i) => sample(start + i));
  return { samples, n, tail, fade, still: brightest - start, delayMs, start: (start * delayMs) / 1000,
    seconds: (n * delayMs) / 1000 };
}

/** The pictures → the loop: 'fade' in from black and out to it over FADE_S, or 'crossfade' the tail into the head. */
function loopFrames(pictures: Uint8Array[], { n, tail, fade }: { n: number, tail: number, fade: number },
  loop: Loop) {
  const mix = (a: Uint8Array, b: Uint8Array | null, t: number) => a.map((v, i) => v * t + (b ? b[i]! * (1 - t) : 0));
  return pictures.slice(0, n).map((img, i) => (loop === 'crossfade'
    ? (i < tail && pictures[n + i] ? mix(img, pictures[n + i]!, (i + 1) / (tail + 1)) : img) // runs on into the head
    : mix(img, null, Math.min(1, (i + 1) / fade, (n - i) / fade))));
}

/** The camera without a browser: the LEDs from the front (z across, y up, the back drawn first). */
export function frontView(width = WIDTH): Camera {
  return async (rig, samples) => {
    const scene = prepareScene(rig), N = scene.count;
    const { min, max } = scene.bounds, spanZ = max[2]! - min[2]! || 1, spanY = max[1]! - min[1]! || 1;
    const W = width, H = Math.max(40, Math.min(2 * W, Math.round((W * spanY) / spanZ)));
    const order = [...Array(N).keys()].sort((a, b) => scene.X[b]! - scene.X[a]!); // the back first, the front on top
    const at = order.map((k) => [1 + Math.round(((scene.Z[k]! - min[2]!) / spanZ) * (W - 3)),
      H - 2 - Math.round(((scene.Y[k]! - min[1]!) / spanY) * (H - 3))] as const);
    const draw = (leds: Uint8Array) => {
      const img = new Uint8Array(W * H * 3);
      order.forEach((k, j) => {
        const [x, y] = at[j]!;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const i = ((y + dy) * W + x + dx) * 3;
            for (let ch = 0; ch < 3; ch++) img[i + ch] = Math.max(img[i + ch]!, leds[3 * k + ch]!);
          }
        }
      });
      return img;
    };
    return { width: W, height: H, pictures: samples.map(draw) };
  };
}

/** Baked frames → the preview's pictures, `delayMs` apart, and its still, through `camera`. */
export async function previewFrames(bytes: Uint8Array, rig: Rig, { loop = 'crossfade' as Loop,
  camera = frontView() } = {}): Promise<Motion> {
  const w = pickWindow(bytes, rig, loop);
  const { width, height, pictures } = await camera(rig, w.samples);
  return { width, height, delayMs: w.delayMs, frames: loopFrames(pictures, w, loop), still: pictures[w.still]!,
    start: w.start, seconds: w.seconds };
}
