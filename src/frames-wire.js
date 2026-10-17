// Baked frames as the browser streams them (SPEC "Baked frames"; public/js/frames-wire.js decodes). Chunks
// of 80 frames (2 s): a layout byte, then the frames in whichever layout compresses smallest (MODES: frame
// after frame, frame deltas mod 256, planar, planar deltas). A chunk's first frame is stored as is, so a
// seek fetches one chunk. Brotli picks the layout at quality 5 (what 9 picks) and compresses at
// WIRE_QUALITY; the gzip copy picks its own (up to 30 % smaller than reusing brotli's).
//   manifest = { version: 1, hash, frames, fps, channels, ranges, chunkFrames, chunks: [{ bytes }], bytes }

import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

export const WIRE_VERSION = 1;
export const CHUNK_FRAMES = 80;
// 15 % smaller than 9 but about 25× slower (1-2 s per second of frames): once per bake, in the background.
export const WIRE_QUALITY = 11;
export const MODES = Object.freeze(['frames', 'frames-delta', 'planar', 'planar-delta']);
const PROBE_QUALITY = 5;
const brotli = promisify(zlib.brotliCompress);
const unbrotli = promisify(zlib.brotliDecompress);
const gzip = promisify(zlib.gzip);
const Z = zlib.constants;
const compress = (bytes, quality) => brotli(bytes, { params: {
  [Z.BROTLI_PARAM_QUALITY]: quality, [Z.BROTLI_PARAM_LGWIN]: 22, [Z.BROTLI_PARAM_SIZE_HINT]: bytes.length } });

/** The name of a bake's chunks: its .fseq's SHA-256 with this format's version and chunk size. */
export function wireHash(sha256) {
  if (!/^[0-9a-f]{64}$/.test(String(sha256))) throw new TypeError('wireHash: pass the frames file\'s sha256');
  const named = `folly-wire/${WIRE_VERSION}/${CHUNK_FRAMES}\n${sha256}`;
  return createHash('sha256').update(named).digest('hex').slice(0, 32);
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

// The chunk laid out every way (into `scratch`, a buffer per layout), measured one at a time by
// size(chunk) → Promise<number> so the thread pool stays free: the smallest, layout byte first.
async function smallest(data, channels, first, count, size, scratch) {
  let best = null, bestSize = Infinity;
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

/** encodeWire(parsed, { hash, quality?, onChunk(n, brotliBytes, mode) }) → manifest, a chunk at a time. */
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
      const prev = mode.endsWith('delta') && i > 0 ? out[o - channels] : 0;
      out[o] = chunk[1 + (planar ? c * count + i : o)] + prev;
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
