// Baked frames as the browser streams them (SPEC "Baked frames"; public/js/frames-wire.js decodes). Chunks
// of 80 frames (2 s): a layout byte, then the frames in whichever layout compresses smallest (MODES: frame
// after frame, frame deltas mod 256, planar, planar deltas). A chunk's first frame is stored as is, so a
// seek fetches one chunk. Brotli picks the layout at quality 5 (what 9 picks) and compresses at the
// quality asked (WIRE_QUALITY by default); the gzip copy picks its own (up to 30 % smaller than reusing
// brotli's). `sync` compresses on the calling thread: the server encodes in a low-priority worker thread.
//   manifest = { version: 1, hash, frames, fps, channels, ranges, chunkFrames, chunks: [{ bytes }], bytes }

import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

import type { Parsed } from './frames.ts';

const WIRE_VERSION = 1;
export const CHUNK_FRAMES = 80;
// Quality 11 is a few % smaller than 9 but several times slower (tools/frames-bench.ts); a home server
// takes 9 by default (STUDIO_FRAMES_BROTLI_QUALITY).
export const WIRE_QUALITY = 9;
export const MODES = Object.freeze(['frames', 'frames-delta', 'planar', 'planar-delta'] as const);
const PROBE_QUALITY = 5;
const brotli = promisify(zlib.brotliCompress);
const unbrotli = promisify(zlib.brotliDecompress);
const gzip = promisify(zlib.gzip);
const Z = zlib.constants;
type Bytes = Uint8Array;
const brotliParams = (bytes: Bytes, quality: number) => ({ params: {
  [Z.BROTLI_PARAM_QUALITY]: quality, [Z.BROTLI_PARAM_LGWIN]: 22, [Z.BROTLI_PARAM_SIZE_HINT]: bytes.length } });
const compressor = (sync: boolean) => (bytes: Bytes, quality: number): Buffer | Promise<Buffer> => (sync
  ? zlib.brotliCompressSync(bytes, brotliParams(bytes, quality)) : brotli(bytes, brotliParams(bytes, quality)));

/** The name of a bake's chunks: its .fseq's SHA-256 with this format's version and chunk size. */
export function wireHash(sha256: string) {
  if (!/^[0-9a-f]{64}$/.test(String(sha256))) throw new TypeError('wireHash: pass the frames file\'s sha256');
  const named = `folly-wire/${WIRE_VERSION}/${CHUNK_FRAMES}\n${sha256}`;
  return createHash('sha256').update(named).digest('hex').slice(0, 32);
}

/** Frames first .. first + count - 1 of frame-major `data` in one of MODES, into out (count × channels). */
export function layoutChunk(data: Bytes, channels: number, first: number, count: number,
  mode: (typeof MODES)[number], out: Bytes = new Uint8Array(count * channels)) {
  const planar = mode === 'planar' || mode === 'planar-delta';
  const delta = mode === 'frames-delta' || mode === 'planar-delta';
  for (let i = 0; i < count; i++) {
    const row = (first + i) * channels;
    for (let c = 0; c < channels; c++) {
      const v = delta && i > 0 ? data[row + c] - data[row - channels + c] : data[row + c];
      out[planar ? c * count + i : i * channels + c] = v; // a Uint8Array keeps it mod 256
    }
  }
  return out;
}

// The chunk laid out every way (into `scratch`, a buffer per layout), measured one at a time by
// size(chunk) → Promise<number> so the thread pool stays free: the smallest, layout byte first.
async function smallest(data: Bytes, channels: number, first: number, count: number,
  size: (chunk: Bytes) => Promise<number>, scratch: Bytes[]) {
  let best = scratch[0]!, bestSize = Infinity;
  for (let m = 0; m < MODES.length; m++) {
    const chunk = scratch[m]!.subarray(0, 1 + count * channels);
    chunk[0] = m;
    layoutChunk(data, channels, first, count, MODES[m]!, chunk.subarray(1));
    const n = await size(chunk);
    if (n < bestSize) [best, bestSize] = [chunk, n];
  }
  return best;
}

const buffers = (channels: number, frames: number) => MODES.map(() => new Uint8Array(1 + frames * channels));

/** The manifest; each chunk goes to onChunk as it is made. */
export async function encodeWire(parsed: Parsed, { hash, quality = WIRE_QUALITY, sync = false, onChunk = () => {} }:
  { hash: string, quality?: number, sync?: boolean, onChunk?: (n: number, bytes: Buffer, mode: string) => unknown }) {
  const compress = compressor(sync);
  const { data, channelCount: channels, frameCount: frames, stepMs, ranges } = parsed;
  const scratch = buffers(channels, Math.min(frames, CHUNK_FRAMES));
  const probe = async (chunk: Bytes) => (await compress(chunk, PROBE_QUALITY)).length;
  const chunks: { bytes: number }[] = [];
  for (let n = 0, first = 0; first < frames; n++, first += CHUNK_FRAMES) {
    const count = Math.min(CHUNK_FRAMES, frames - first);
    const chunk = await smallest(data, channels, first, count, probe, scratch);
    const bytes = await compress(chunk, quality);
    await onChunk(n, bytes, MODES[chunk[0]!]!);
    chunks.push({ bytes: bytes.length });
  }
  return {
    version: WIRE_VERSION, hash, frames, fps: 1000 / stepMs, channels,
    ranges: ranges.map(([s, c]) => [s, c]), chunkFrames: CHUNK_FRAMES, chunks,
    bytes: chunks.reduce((n, c) => n + c.bytes, 0),
  };
}

/** A brotli chunk's frames, frame-major again (the inverse of layoutChunk). */
function restoreChunk(chunk: Bytes, channels: number) {
  const count = (chunk.length - 1) / channels;
  const mode = MODES[chunk[0]!];
  if (!mode || !Number.isInteger(count) || count < 1) throw new Error('restoreChunk: not a chunk');
  const planar = mode === 'planar' || mode === 'planar-delta';
  const out = new Uint8Array(count * channels);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < channels; c++) {
      const o = i * channels + c;
      const prev = mode.endsWith('delta') && i > 0 ? out[o - channels] : 0;
      out[o] = chunk[1 + (planar ? c * count + i : o)] + prev;
    }
  }
  return { data: out, count };
}

/** The same chunk for a client without br: gzip, in whichever layout gzip makes smallest. */
export async function gzipChunk(brotliBytes: Bytes, channels: number, { sync = false } = {}) {
  const raw = sync ? zlib.brotliDecompressSync(brotliBytes) : await unbrotli(brotliBytes);
  const { data, count } = restoreChunk(raw, channels);
  let best: Buffer | null = null;
  const size = async (chunk: Bytes) => {
    const bytes = sync ? zlib.gzipSync(chunk, { level: 9 }) : await gzip(chunk, { level: 9 });
    if (!best || bytes.length < best.length) best = bytes;
    return bytes.length;
  };
  await smallest(data, channels, 0, count, size, buffers(channels, count));
  return best!;
}
