// Data-only checks on baked frames (an FSEQ v2 file), for the trusted side. Pure: no I/O, no Node
// APIs, no imports but types, nothing here runs code. The Fleet box runs a copy on its own bake (advisory; the server
// repeats it). The rig arrives as the pattern core's scene and flash regions (prepareScene, flashRegions).

import type { Span } from '../public/js/fseq.ts';
import type { Region, Scene } from '../public/js/pattern-core.ts';
import type { Analysis } from '../shared/schemas/api.ts';

export const CHANNELS_PER_UNIVERSE = 510; // a parsed file's default bounds: 80 universes of 510 (xLights, FPP)
export const UNIVERSES = 80;
export const MAX_CHANNELS = UNIVERSES * CHANNELS_PER_UNIVERSE; // 40,800
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

// Photosensitivity: WCAG 2.3.1's general flash threshold for a building. A flash is a pair of opposing
// changes in relative luminance of ≥ 10 % with the darker state below 0.80; over three a second fail.
// Regions are the rig and each top-level group (their mean luminance). Red flash: not checked.
export const FLASH = Object.freeze({ delta: 0.1, darker: 0.8, perSecond: 3 });
// Only large-area flashing blocks review; flashing confined to a small region is a warning (the core's
// flashRegions says which regions are large).
// Power: WS281x pixels draw about 20 mA per channel at full, at 5 V: an estimate for sizing supplies.
export const AMPS_PER_CHANNEL = 0.02;
const DARK = 10; // a pixel is dark when every channel is below this (about 4 %)
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
export type Decompress = (type: string, bytes: Bytes, size: number) => Bytes;
export function parseFseq(input: Bytes | ArrayBuffer, opts: { maxBytes?: number, maxChannels?: number,
  maxDataBytes?: number, decompress?: Decompress } = {}) {
  const { maxBytes = DEFAULT_MAX_BYTES, maxChannels = MAX_CHANNELS, maxDataBytes = maxBytes, decompress } = opts;
  const b = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!b) fail('not a byte buffer');
  if (b.length > maxBytes) fail(`${b.length} bytes is over the ${maxBytes}-byte limit`);
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
  if (compression !== 'none' && typeof decompress !== 'function') fail('compressed files are not accepted here');
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
  let data = b.subarray(dataOffset);
  if (compression === 'none') {
    if (data.length !== expected) fail(`holds ${data.length} bytes of channel data, expected ${shape} = ${expected}`);
  } else {
    if (expected > maxDataBytes) fail(`${shape} exceed the ${maxDataBytes}-byte limit`);
    data = inflateBlocks(b, { compression, blocks, dataOffset, channelCount, frameCount, decompress: decompress! });
  }
  const sparse = rangeCount > 0;
  return { version: `2.${minor}`, channelCount, frameCount, stepMs, fps: 1000 / stepMs, ranges, sparse, variables,
    compression, blocks, data };
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
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

/** What the frames show on the scene (regions: the whole, by default): one pass, no allocation per frame. Channels
 * the file does not hold count as off. */
export function analyzeFrames(parsed: Parsed, scene: Scene,
  regions: readonly Region[] = [{ id: 'all', idx: null, large: true }]): Analysis {
  const { data, channelCount: cc, frameCount: F, stepMs, ranges } = parsed;
  const N = scene.count;
  const [cR, cG, cB] = scene.order as [number, number, number];
  // Absolute channel → its byte within a frame (−1 when the file does not hold it).
  const size = ranges.reduce((n, [s, c]) => Math.max(n, s + c), 0);
  const where = new Int32Array(size).fill(-1);
  let off = 0;
  for (const [s, c] of ranges) for (let i = 0; i < c; i++) where[s + i] = off++;
  const [oR, oG, oB] = [new Int32Array(N), new Int32Array(N), new Int32Array(N)];
  let covered = 0;
  for (let k = 0; k < N; k++) {
    const a = scene.addr[k];
    const at = (c: number) => (a >= 0 && a + c < size ? where[a + c] : -1);
    [oR[k], oG[k], oB[k]] = [at(cR), at(cG), at(cB)];
    covered += +(oR[k] >= 0) + +(oG[k] >= 0) + +(oB[k] >= 0);
  }

  // Flash detector per region: a swing is confirmed once luminance turns back by `delta` from its
  // extreme, so slow drift and small shimmer never count. Swings are stored by frame.
  const R = regions.length;
  const { delta, darker, perSecond } = FLASH;
  const EPS = 1e-9;
  const state = new Int8Array(R); // 0 = not moving yet, 1 = rising, −1 = falling
  const prev = new Float64Array(R); // the extreme the current swing started from
  const ext = new Float64Array(R); // the current swing's extreme so far
  const extAt = new Int32Array(R);
  const lo = new Float64Array(R).fill(Infinity);
  const hi = new Float64Array(R).fill(-Infinity);
  const swings = new Int32Array(R * (F + 1));
  const nSwings = new Int32Array(R);
  const swing = (j: number, from: number, to: number, at: number) => {
    if (Math.min(from, to) < darker) swings[j * (F + 1) + nSwings[j]++] = at;
  };
  const extreme = (j: number, v: number, f: number) => { ext[j] = v; extAt[j] = f; };
  const feed = (j: number, v: number, f: number) => {
    const s = state[j];
    if (s === 0) {
      if (v < lo[j]) lo[j] = v;
      if (v > hi[j]) hi[j] = v;
      if (v - lo[j] >= delta - EPS) [state[j], prev[j]] = [1, lo[j]];
      else if (hi[j] - v >= delta - EPS) [state[j], prev[j]] = [-1, hi[j]];
      else return;
      extreme(j, v, f);
    } else if (s === 1 ? v > ext[j] : v < ext[j]) {
      extreme(j, v, f);
    } else if (Math.abs(ext[j] - v) >= delta - EPS) {
      swing(j, prev[j], ext[j], extAt[j]);
      [prev[j], state[j]] = [ext[j], -s];
      extreme(j, v, f);
    }
  };

  const lum = new Float32Array(N);
  let peak = 0, total = 0, dark = 0;
  for (let f = 0; f < F; f++) {
    const base = f * cc;
    let sum = 0, lsum = 0;
    for (let k = 0; k < N; k++) {
      const r = oR[k] >= 0 ? data[base + oR[k]] : 0;
      const g = oG[k] >= 0 ? data[base + oG[k]] : 0;
      const b = oB[k] >= 0 ? data[base + oB[k]] : 0;
      sum += r + g + b;
      if (r < DARK && g < DARK && b < DARK) dark++;
      // Relative luminance. LED PWM values are already linear light, so no sRGB decoding.
      lsum += lum[k] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }
    if (sum > peak) peak = sum;
    total += sum;
    for (let j = 0; j < R; j++) {
      const idx = regions[j].idx;
      if (!idx) { feed(j, lsum / N, f); continue; }
      let s = 0;
      for (let i = 0; i < idx.length; i++) s += lum[idx[i]];
      feed(j, s / idx.length, f);
    }
  }
  for (let j = 0; j < R; j++) {
    if (state[j] !== 0 && Math.abs(ext[j] - prev[j]) >= delta - EPS) swing(j, prev[j], ext[j], extAt[j]);
  }

  // Any one-second window holding more than 2 × perSecond swings (> perSecond flashes) is flagged:
  // on a large region it blocks review, on a small one it is a warning.
  const seconds = (F * stepMs) / 1000;
  const large = regions.map((r) => r.large);
  const kinds = [0, 1].map(() => ({ mask: new Uint8Array(Math.ceil(seconds) + 1), regions: [] as string[],
    swings: 0 }));
  const second = (frame: number) => Math.floor((frame * stepMs) / 1000);
  for (let j = 0; j < R; j++) {
    const t = swings.subarray(j * (F + 1), j * (F + 1) + nSwings[j]);
    const kind = kinds[large[j] ? 0 : 1];
    let flagged = false;
    for (let q = 0, i = 0; q < t.length; q++) {
      while ((t[q] - t[i]) * stepMs >= 1000) i++;
      kind.swings = Math.max(kind.swings, q - i + 1);
      if (q - i + 1 <= 2 * perSecond) continue;
      flagged = true;
      for (let s = second(t[i]); s <= second(t[q]); s++) kind.mask[s] = 1;
    }
    if (flagged) kind.regions.push(regions[j].id);
  }
  const [big, small] = kinds.map((k) => {
    const flaggedSeconds: number[] = [];
    k.mask.forEach((v, s) => v && flaggedSeconds.push(s));
    return { maxHz: k.swings / 2, flaggedSeconds, regions: k.regions };
  });

  return {
    frames: F, seconds: round(seconds, 3), fps: round(1000 / stepMs, 2), channels: cc, sparse: parsed.sparse === true,
    pixels: N,
    coverage: round(covered / (3 * N), 3), // share of the LED map's channels the file holds
    peakBrightness: round(peak / (765 * N), 3), // brightest frame, as a share of all-white
    meanBrightness: round(total / (765 * N * F), 3), darkFraction: round(dark / (N * F), 3),
    estPeakAmps: round((peak / 255) * AMPS_PER_CHANNEL, 1),
    flicker: { ...big, ok: big.regions.length === 0, small },
  };
}

const around = (f: { flaggedSeconds: number[] }) => f.flaggedSeconds.slice(0, 6).map((s) => `${s} s`).join(', ')
  + (f.flaggedSeconds.length > 6 ? ', …' : '');

/** One line on a failed flicker check (large-area flashing), for people. */
export function flickerReason(analysis?: Analysis) {
  const f = analysis?.flicker;
  if (!f || f.ok) return '';
  return `Large-area flashing at up to ${f.maxHz} flashes a second (over ${FLASH.perSecond} is unsafe for `
    + `photosensitive people) around ${around(f)}, on ${f.regions.join(', ')}.`;
}

/** One line on flashing confined to small regions (allowed, but worth a look), or ''. */
export function flickerWarning(analysis?: Analysis) {
  const f = analysis?.flicker?.small;
  if (!f?.regions?.length) return '';
  return `Fast flashing on small parts only (${f.regions.join(', ')}) at up to ${f.maxHz} flashes a second `
    + `around ${around(f)}. Allowed, as no large area flashes; check it is meant.`;
}
