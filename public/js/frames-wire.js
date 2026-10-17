// Decodes baked frames as the server streams them (src/frames-wire.js encodes; SPEC "Baked frames").
// Chunk n holds frames n × chunkFrames onward: a layout byte (MODES: frame-major, frame deltas mod 256,
// planar, planar deltas), then the frames, the first stored as is so every chunk decodes alone. The
// browser has undone the brotli or gzip (Content-Encoding); the deltas are undone here, in place.

export const MODES = Object.freeze(['frames', 'frames-delta', 'planar', 'planar-delta']);
const MAX_CHANNELS = 80 * 510;
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** Check a manifest from the server and return a clean copy. */
export function parseManifest(m) {
  const bad = (why) => { throw new Error(`The baked frames' manifest is malformed (${why}).`); };
  if (!m || typeof m !== 'object') bad('not an object');
  if (m.version !== 1) bad(`version ${m.version}`);
  if (typeof m.hash !== 'string' || !/^[0-9a-f]{32}$/.test(m.hash)) bad('hash');
  if (!whole(m.frames, 1, 1e7)) bad('frames');
  if (!(typeof m.fps === 'number' && m.fps > 0 && m.fps <= 1000)) bad('fps');
  if (!whole(m.channels, 1, MAX_CHANNELS)) bad('channels');
  if (!Array.isArray(m.ranges) || m.ranges.length > 255) bad('ranges');
  let end = 0, total = 0;
  for (const r of m.ranges) {
    if (!Array.isArray(r) || !whole(r[0], end, MAX_CHANNELS - 1) || !whole(r[1], 1, MAX_CHANNELS - r[0])) {
      bad('ranges');
    }
    end = r[0] + r[1];
    total += r[1];
  }
  if (m.ranges.length && total !== m.channels) bad('the ranges do not add up to the channels');
  if (!whole(m.chunkFrames, 1, 1e5)) bad('chunkFrames');
  if (!Array.isArray(m.chunks) || m.chunks.length !== Math.ceil(m.frames / m.chunkFrames)) bad('chunk count');
  let bytes = 0;
  for (const c of m.chunks) {
    if (!c || !whole(c.bytes, 1, 2 ** 31)) bad('chunk');
    bytes += c.bytes;
  }
  if (m.bytes !== bytes) bad('the chunk sizes do not add up');
  return {
    version: 1, hash: m.hash, frames: m.frames, fps: m.fps, channels: m.channels,
    ranges: m.ranges.length ? m.ranges.map(([s, c]) => [s, c]) : [[0, m.channels]],
    chunkFrames: m.chunkFrames, chunks: m.chunks.map((c) => ({ bytes: c.bytes })), bytes,
  };
}

/** How many frames chunk n holds (the last may be short). */
export function chunkLength(manifest, n) {
  return Math.min(manifest.chunkFrames, manifest.frames - n * manifest.chunkFrames);
}

/** decodeChunk(bytes, manifest, n) → { data, frames, planar }: chunk n's deltas undone in place (a view). */
export function decodeChunk(bytes, manifest, n) {
  const frames = chunkLength(manifest, n);
  const C = manifest.channels;
  if (!(frames > 0) || n >= manifest.chunks.length) throw new Error(`There is no chunk ${n}.`);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 1 + frames * C) {
    throw new Error(`Chunk ${n} holds ${bytes?.length} bytes, not 1 + ${frames} frames × ${C} channels.`);
  }
  const mode = MODES[bytes[0]];
  if (!mode) throw new Error(`Chunk ${n} has an unknown layout (${bytes[0]}).`);
  const data = bytes.subarray(1);
  // A Uint8Array stores sums mod 256, which undoes the encoder's mod-256 differences exactly.
  if (mode === 'frames-delta') for (let i = C; i < data.length; i++) data[i] += data[i - C];
  if (mode === 'planar-delta') {
    for (let o = 0; o < data.length; o += frames) for (let i = o + 1; i < o + frames; i++) data[i] += data[i - 1];
  }
  return { data, frames, planar: mode === 'planar' || mode === 'planar-delta' };
}

/** Frame j of a decoded chunk into out (one byte per channel, frame order). */
export function readFrame(chunk, j, out) {
  const { data, frames, planar } = chunk;
  const C = out.length;
  if (planar) for (let c = 0, o = j; c < C; c++, o += frames) out[c] = data[o];
  else for (let c = 0, o = j * C; c < C; c++, o++) out[c] = data[o];
  return out;
}
