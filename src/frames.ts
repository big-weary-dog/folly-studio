// Data-only checks on baked frames (an FSEQ v2 file), for the trusted side. Pure: no I/O, no Node
// APIs, no imports but types, nothing here runs code. The Fleet box runs a copy on its own bake (advisory; the server
// repeats it). The rig arrives as the pattern core's scene, and the flash check as its FlashWatch (prepareScene).

import type { Span } from '../public/js/fseq.ts';
import type { FlashWatch, Scene } from '../public/js/pattern-core.ts';
import type { Analysis } from '../shared/schemas/api.ts';

export const CHANNELS_PER_UNIVERSE = 510; // a parsed file's default bounds: 80 universes of 510 (xLights, FPP)
const UNIVERSES = 80;
export const MAX_CHANNELS = UNIVERSES * CHANNELS_PER_UNIVERSE; // 40,800
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

// Photosensitivity: fast, big, wide flashing (WCAG 2.3.1's three a second), as the core's FlashWatch (core/flash.ts)
// judges it. Only large-area flashing blocks review; flashing confined to small places is a warning. Red flash: not
// checked.
// Everything is measured in the light the LEDs give: bakes hold encoded bytes, so each is decoded by the LEDs'
// output transform (the core's ledLight) first.
// Power: WS281x pixels draw about 20 mA per channel at full, at 5 V: an estimate for sizing supplies.
const AMPS_PER_CHANNEL = 0.02;
const DARK = 0.01; // a pixel is dark when every channel gives under 1 % of its light (encoded, below about 0.12)
const CODECS = ['none', 'zstd', 'zlib']; // FSEQ v2 compression types 0, 1, 2

export class FseqError extends Error { name = 'FseqError'; }

function fail(msg: string): never { throw new FseqError(`frames: ${msg}`); }
type Bytes = Uint8Array;
const u16 = (b: Bytes, o: number) => b[o] | (b[o + 1] << 8);
const u24 = (b: Bytes, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32 = (b: Bytes, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
// oxlint-disable-next-line no-control-regex -- control characters are what it strips from header text
const CONTROL = /[\u0000-\u001f\u007f]/g;
const text = (bytes: Bytes) => new TextDecoder('utf-8').decode(bytes.subarray(0,
  Math.min(bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0), 256))).replace(CONTROL, '');

/**
 * An FSEQ file parsed, or FseqError. Strict: header fields agree with each other and the file size; sparse ranges
 * ascend within maxChannels. The data is a view, not a copy. Compressed files need `decompress(type, bytes, size)` →
 * Uint8Array(size), which must refuse to make more than `size` bytes: each block is exactly its frames, the whole ≤
 * maxDataBytes.
 */
/** parseFseq's `decompress`: one block of `type`, inflated to exactly `size` bytes (or it throws). */
type Decompress = (type: string, bytes: Bytes, size: number) => Bytes;
export function parseFseq(input: Bytes | ArrayBuffer, opts: { maxBytes?: number, maxChannels?: number,
  maxDataBytes?: number, decompress?: Decompress } = {}) {
  const { maxBytes = DEFAULT_MAX_BYTES, maxChannels = MAX_CHANNELS, maxDataBytes = maxBytes, decompress } = opts;
  const b = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!b) fail('not a byte buffer');
  const h = parseFseqHeader(b, { fileBytes: b.length, maxBytes, maxChannels, compressed: !!decompress });
  const { channelCount, frameCount, compression, blocks, dataOffset } = h;
  const expected = channelCount * frameCount;
  let data = b.subarray(dataOffset);
  if (compression !== 'none') {
    if (expected > maxDataBytes) {
      fail(`${frameCount} frames × ${channelCount} channels exceed the ${maxDataBytes}-byte limit`);
    }
    data = inflateBlocks(b, { compression, blocks, dataOffset, channelCount, frameCount, decompress: decompress! });
  }
  return { ...h, data };
}

/** Validate metadata against the actual file size without allocating its frame data. */
export function parseFseqHeader(b: Bytes, { fileBytes, maxBytes = DEFAULT_MAX_BYTES,
  maxChannels = MAX_CHANNELS, compressed = false }: {
  fileBytes: number, maxBytes?: number, maxChannels?: number, compressed?: boolean }) {
  if (fileBytes > maxBytes) fail(`${fileBytes} bytes is over the ${maxBytes}-byte limit`);
  if (b.length < 32) fail('shorter than an FSEQ header');
  if (b[0] !== 0x50 || b[1] !== 0x53 || b[2] !== 0x45 || b[3] !== 0x51) fail('not an FSEQ file');
  const [minor, major] = [b[6], b[7]];
  if (major !== 2) fail(`FSEQ version ${major}.${minor}: only 2.x is accepted`);
  const [dataOffset, headerLength, stepMs] = [u16(b, 4), u16(b, 8), b[18]];
  const [channelCount, frameCount] = [u32(b, 10), u32(b, 14)];
  const compression = CODECS[b[20] & 0x0f];
  const blocks = ((b[20] & 0xf0) << 4) | b[21];
  const rangeCount = b[22];
  if (!compression) fail(`unknown compression type ${b[20] & 0x0f}`);
  if (compression !== 'none' && !compressed) fail('compressed files are not accepted here');
  if (compression === 'none' && blocks !== 0) fail('an uncompressed file lists compression blocks');
  if (compression !== 'none' && blocks === 0) fail('a compressed file lists no compression blocks');
  const rangesAt = 32 + 8 * blocks;
  if (headerLength !== rangesAt + 6 * rangeCount) {
    const parts = `${blocks ? `${blocks} compression blocks and ` : ''}${rangeCount} sparse ranges`;
    fail(`header length ${headerLength} does not fit ${parts}`);
  }
  if (dataOffset < headerLength || dataOffset > b.length) {
    fail(`channel data offset ${dataOffset} is outside the header or file`);
  }
  if (stepMs < 1) fail('step time is 0 ms');
  if (channelCount < 1) fail('no channels');
  if (frameCount < 1) fail('no frames');

  const ranges: Span[] = [];
  if (rangeCount) {
    let end = 0;
    let total = 0;
    for (let i = 0, at = rangesAt; i < rangeCount; i++, at += 6) {
      const [start, count] = [u24(b, at), u24(b, at + 3)];
      if (count < 1) fail(`sparse range ${i + 1} is empty`);
      if (start < end) fail(`sparse range ${i + 1} overlaps or is out of order`);
      if (start + count > maxChannels) fail(`sparse range ${i + 1} ends past channel ${maxChannels}`);
      ranges.push([start, count]);
      end = start + count;
      total += count;
    }
    if (total !== channelCount) fail(`channel count ${channelCount} is not the sparse ranges' total ${total}`);
  } else {
    if (channelCount > maxChannels) fail(`${channelCount} channels: at most ${maxChannels}`);
    ranges.push([0, channelCount]);
  }

  const variables: Record<string, string> = {};
  for (let at = headerLength; at + 4 <= dataOffset;) {
    const len = u16(b, at);
    if (len === 0) break; // padding up to the channel data
    if (len < 4 || at + len > dataOffset) fail(`variable header at byte ${at} runs past the channel data`);
    const code = String.fromCharCode(b[at + 2], b[at + 3]);
    if (!/^[\x21-\x7e]{2}$/.test(code)) fail(`variable header at byte ${at} has no code`);
    if (Object.keys(variables).length < 16 && !(code in variables)) {
      variables[code] = text(b.subarray(at + 4, at + len));
    }
    at += len;
  }

  const expected = channelCount * frameCount;
  const shape = `${frameCount} frames × ${channelCount} channels`;
  if (compression === 'none') {
    if (fileBytes - dataOffset !== expected) {
      fail(`holds ${fileBytes - dataOffset} bytes of channel data, expected ${shape} = ${expected}`);
    }
  }
  const sparse = rangeCount > 0;
  return { version: `2.${minor}`, channelCount, frameCount, stepMs, fps: 1000 / stepMs, ranges, sparse, variables,
    compression, blocks, dataOffset };
}

// The block index (from byte 32: u32 first frame, u32 length), checked and inflated into one buffer.
// Zero-length entries may only pad the end of the index (FPP preallocates).
function inflateBlocks(b: Bytes, { compression, blocks, dataOffset, channelCount, frameCount, decompress }: {
  compression: string, blocks: number, dataOffset: number, channelCount: number, frameCount: number,
  decompress: Decompress }) {
  const index: { frame: number, length: number }[] = [];
  let padding = false;
  for (let i = 0, at = 32; i < blocks; i++, at += 8) {
    const [frame, length] = [u32(b, at), u32(b, at + 4)];
    if (!length) { padding = true; continue; }
    if (padding) fail(`compression block ${i + 1} follows an empty one`);
    const follows = index.length ? frame > index.at(-1)!.frame : frame === 0;
    if (!follows) fail(`compression block ${i + 1} does not follow the last`);
    if (frame >= frameCount) fail(`compression block ${i + 1} starts past the last frame`);
    index.push({ frame, length });
  }
  if (!index.length) fail('every compression block is empty');
  const stored = index.reduce((n, x) => n + x.length, 0);
  if (stored !== b.length - dataOffset) {
    fail(`holds ${b.length - dataOffset} bytes of compressed data, the block index says ${stored}`);
  }
  const data = new Uint8Array(channelCount * frameCount);
  for (let i = 0, at = dataOffset; i < index.length; at += index[i++].length) {
    const frames = (i + 1 < index.length ? index[i + 1].frame : frameCount) - index[i].frame;
    const size = frames * channelCount;
    let out: Bytes | null = null;
    try {
      out = decompress(compression, b.subarray(at, at + index[i].length), size);
    } catch { /* refused below */ }
    if (!(out instanceof Uint8Array) || out.length !== size) {
      fail(`compression block ${i + 1} does not inflate to its ${frames} frames (${size} bytes)`);
    }
    data.set(out, index[i].frame * channelCount);
  }
  return data;
}

export type Parsed = ReturnType<typeof parseFseq>;
/** Each LED's R, G and B byte within a frame (−1 when the file does not hold it). */
export function frameOffsets({ ranges }: Pick<Parsed, 'ranges'>, scene: Pick<Scene, 'addr' | 'order'>)
  : [Int32Array, Int32Array, Int32Array] {
  const size = ranges.reduce((n, [s, c]) => Math.max(n, s + c), 0), where = new Int32Array(size).fill(-1);
  let off = 0;
  for (const [s, c] of ranges) for (let i = 0; i < c; i++) where[s + i] = off++;
  return scene.order.map((c) => Int32Array.from(scene.addr, (a) =>
    (a >= 0 && a + c < size ? where[a + c]! : -1))) as [Int32Array, Int32Array, Int32Array];
}
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

/** What the frames show on the scene, in LED light: one pass, no allocation per frame. `watch`: the core's FlashWatch
 * for the scene, recording (new FlashWatch(scene, limits, { record: true })); `light`: the core's ledLight(), each
 * byte's light. Channels the file does not hold count as off. */
export function analyzeFrames(parsed: Parsed, scene: Scene, watch: FlashWatch, light: ArrayLike<number>): Analysis {
  const { data, channelCount: cc, frameCount: F, stepMs } = parsed;
  const N = scene.count;
  const [oR, oG, oB] = frameOffsets(parsed, scene);
  let covered = 0;
  for (let k = 0; k < N; k++) {
    covered += +(oR[k] >= 0) + +(oG[k] >= 0) + +(oB[k] >= 0);
  }

  const lum = new Float32Array(N);
  let peak = 0, total = 0, dark = 0;
  watch.reset();
  for (let f = 0; f < F; f++) {
    const base = f * cc;
    let sum = 0;
    for (let k = 0; k < N; k++) {
      // Bytes are encoded values; light[] is what the LEDs make of them, linear and 0..1.
      const r = light[oR[k] >= 0 ? data[base + oR[k]] : 0];
      const g = light[256 + (oG[k] >= 0 ? data[base + oG[k]] : 0)];
      const b = light[512 + (oB[k] >= 0 ? data[base + oB[k]] : 0)];
      sum += r + g + b;
      if (r < DARK && g < DARK && b < DARK) dark++;
      lum[k] = r > g ? (r > b ? r : b) : g > b ? g : b; // its brightest channel: a red strobe is a full swing
    }
    if (sum > peak) peak = sum;
    total += sum;
    watch.frame(lum, f * stepMs);
  }
  // On a large area flashing blocks review; on small places alone it is a warning.
  const { large, small } = watch.report(), seconds = (F * stepMs) / 1000;
  const { perSecond, delta, area } = watch.limits;
  return {
    frames: F, seconds: round(seconds, 3), fps: round(1000 / stepMs, 2), channels: cc, sparse: parsed.sparse === true,
    pixels: N,
    coverage: round(covered / (3 * N), 3), // share of the LED map's channels the file holds
    peakBrightness: round(peak / (3 * N), 3), // brightest frame's light, as a share of all-white
    meanBrightness: round(total / (3 * N * F), 3), darkFraction: round(dark / (N * F), 3),
    estPeakAmps: round(peak * AMPS_PER_CHANNEL, 1),
    flicker: { ...large, ok: large.regions.length === 0, small, limits: { perSecond, delta, area } },
  };
}

const around = (f: { flaggedSeconds: number[] }) => f.flaggedSeconds.slice(0, 6).map((s) => `${s} s`).join(', ')
  + (f.flaggedSeconds.length > 6 ? ', …' : '');

/** One line on a failed flicker check (large-area flashing), for people. */
export function flickerReason(analysis?: Analysis) {
  const f = analysis?.flicker;
  if (!f || f.ok) return '';
  return `Large-area flashing at up to ${f.maxHz} flashes a second (over ${f.limits?.perSecond ?? 3} is unsafe for `
    + `photosensitive people) around ${around(f)}, on ${f.regions.join(', ')}.`;
}

/** One line on flashing confined to small regions (allowed, but worth a look), or ''. */
export function flickerWarning(analysis?: Analysis) {
  const f = analysis?.flicker?.small;
  if (!f?.regions?.length) return '';
  return `Fast flashing on small parts only (${f.regions.join(', ')}) at up to ${f.maxHz} flashes a second `
    + `around ${around(f)}. Allowed, as no large area flashes; check it is meant.`;
}
