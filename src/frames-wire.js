// frames-wire.js: baked frames as the browser streams them. The decoder is public/js/frames-wire.js.
//
// Frames go in chunks of 80 (2 s at 40 fps). A chunk is one byte naming its layout, then its frames
// in that layout, whichever of four compresses smallest:
//   0 frames        frame after frame, as in the .fseq
//   1 frames-delta  each frame as its byte-wise difference (mod 256) from the frame before
//   2 planar        channel-major: each channel's values in a row
//   3 planar-delta  channel-major, each value minus the channel's previous value (mod 256)
// A chunk's first frame is a delta against zeros (stored as is), never against the previous chunk's
// last frame: that would save 2-4 % (measured on the library) but tie every chunk to the one before,
// and here any chunk decodes alone, so a seek fetches one chunk and nothing else.
// Why four: on the library (20 s, brotli 9) planar-delta wins smooth looks (palette drift 0.53 MB,
// frame-major delta 0.80, raw 2.57), raw frames win sharp motion, where brotli's matches follow the
// movement and deltas only add noise (meteors 0.51 MB, delta 1.26, planar-delta 1.52), and planar
// wins pulses (heartbeat 0.60 MB, planar-delta 0.70). Brotli chunks are chosen with a fast brotli
// (quality 5 picks what quality 9 picks) and compressed at WIRE_QUALITY; the gzip fallback (browsers
// send br only over HTTPS) picks its own layout, which saves up to 30 % over reusing brotli's.
//
//   wireHash(sha256) → 32 hex chars: the frames' content hash, versioned; names the stored chunks
//   layoutChunk(data, channels, first, count, mode, out?) → out
//   encodeWire(parsed, { hash, quality?, onChunk(n, bytes, mode) }) → Promise<manifest>
//   gzipChunk(brotliBytes, channels) → Promise<Buffer>   the same frames, for clients without br
//   manifest = { version: 1, hash, frames, fps, channels, ranges, chunkFrames, chunks: [{ bytes }],
//                bytes }   (bytes: brotli sizes, and their total)

import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

export const WIRE_VERSION = 1;
export const CHUNK_FRAMES = 80;
// Quality 11 is 15 % smaller than 9 on the library but about 25× slower to encode (1-2 s per second
// of frames, on one core). It runs once per bake, in the background, and bandwidth matters more.
export const WIRE_QUALITY = 11;
export const MODES = Object.freeze(['frames', 'frames-delta', 'planar', 'planar-delta']);
const PROBE_QUALITY = 5;

const brotli = promisify(zlib.brotliCompress);
const unbrotli = promisify(zlib.brotliDecompress);
const gzip = promisify(zlib.gzip);
const compress = (bytes, quality) => brotli(bytes, { params: {
  [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
  [zlib.constants.BROTLI_PARAM_LGWIN]: 22,
  [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
} });

/** The name of a bake's chunks: its .fseq's SHA-256 with this format's version and chunk size. */
export function wireHash(sha256) {
  if (!/^[0-9a-f]{64}$/.test(String(sha256))) throw new TypeError('wireHash: pass the frames file\'s sha256');
  const name = `folly-wire/${WIRE_VERSION}/${CHUNK_FRAMES}\n${sha256}`;
  return createHash('sha256').update(name).digest('hex').slice(0, 32);
}

/** Frames first .. first + count - 1 of frame-major `data` in one of MODES, into out (count × channels). */
export function layoutChunk(data, channels, first, count, mode, out = new Uint8Array(count * channels)) {
  const planar = mode === 'planar' || mode === 'planar-delta';
  const delta = mode === 'frames-delta' || mode === 'planar-delta';
  if (!MODES.includes(mode)) throw new TypeError(`layoutChunk: unknown mode ${mode}`);
  for (let i = 0; i < count; i++) {
    const row = (first + i) * channels;
    for (let c = 0; c < channels; c++) {
      const v = delta && i > 0 ? data[row + c] - data[row - channels + c] : data[row + c];
      out[planar ? c * count + i : i * channels + c] = v; // a Uint8Array keeps it mod 256
    }
  }
  return out;
}

/**
 * Lay out frames first .. first + count - 1 every way, measure each with size(chunk) → Promise<number>
 * (one at a time: the thread pool stays free), and return the smallest chunk, layout byte first.
 * `scratch` holds a reusable buffer per layout.
 */
async function smallest(data, channels, first, count, size, scratch) {
  let best = null;
  let bestSize = Infinity;
  for (let m = 0; m < MODES.length; m++) {
    const chunk = scratch[m].subarray(0, 1 + count * channels);
    chunk[0] = m;
    layoutChunk(data, channels, first, count, MODES[m], chunk.subarray(1));
    const n = await size(chunk);
    if (n < bestSize) [best, bestSize] = [chunk, n];
  }
  return best;
}

const buffers = (channels, frames) => MODES.map(() => new Uint8Array(1 + frames * channels));

/**
 * Encode parsed frames (parseFseq) for the wire, one chunk at a time: try each layout, keep the
 * smallest, hand its brotli bytes to onChunk(n, bytes, mode), and resolve with the manifest.
 */
export async function encodeWire(parsed, { hash, quality = WIRE_QUALITY, onChunk = () => {} } = {}) {
  const { data, channelCount: channels, frameCount: frames, stepMs, ranges } = parsed;
  if (!(data instanceof Uint8Array) || data.length !== frames * channels) {
    throw new TypeError('encodeWire: pass the result of parseFseq');
  }
  const scratch = buffers(channels, Math.min(frames, CHUNK_FRAMES));
  const probe = async (chunk) => (await compress(chunk, PROBE_QUALITY)).length;
  const chunks = [];
  for (let n = 0, first = 0; first < frames; n++, first += CHUNK_FRAMES) {
    const count = Math.min(CHUNK_FRAMES, frames - first);
    const chunk = await smallest(data, channels, first, count, probe, scratch);
    const bytes = await compress(chunk, quality);
    await onChunk(n, bytes, MODES[chunk[0]]);
    chunks.push({ bytes: bytes.length });
  }
  return {
    version: WIRE_VERSION, hash, frames, fps: 1000 / stepMs, channels,
    ranges: ranges.map(([s, c]) => [s, c]), chunkFrames: CHUNK_FRAMES, chunks,
    bytes: chunks.reduce((n, c) => n + c.bytes, 0),
  };
}

/** A brotli chunk's frames, frame-major again (the inverse of layoutChunk). */
function restoreChunk(chunk, channels) {
  const count = (chunk.length - 1) / channels;
  const mode = MODES[chunk[0]];
  if (!mode || !Number.isInteger(count) || count < 1) throw new Error('restoreChunk: not a chunk');
  const planar = mode === 'planar' || mode === 'planar-delta';
  const out = new Uint8Array(count * channels);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < channels; c++) {
      const o = i * channels + c;
      out[o] = chunk[1 + (planar ? c * count + i : o)] + (mode.endsWith('delta') && i > 0 ? out[o - channels] : 0);
    }
  }
  return { data: out, count };
}

/** The same chunk for a client without br: gzip, in whichever layout gzip makes smallest. */
export async function gzipChunk(brotliBytes, channels) {
  const { data, count } = restoreChunk(await unbrotli(brotliBytes), channels);
  let best = null;
  const size = async (chunk) => {
    const bytes = await gzip(chunk, { level: 9 });
    if (!best || bytes.length < best.length) best = bytes;
    return bytes.length;
  };
  await smallest(data, channels, 0, count, size, buffers(channels, count));
  return best;
}
