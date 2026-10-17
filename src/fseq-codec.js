// FSEQ v2 compression with node:zlib, for .fseq downloads and parseFseq's `decompress`: zstd (type 1)
// and zlib (type 2) as FPP and xLights write them, each block a whole zstd frame or zlib stream.
// FSEQ_CODEC is 'zstd' when this Node has it (22.15+, 23.8+), else 'zlib'.

import { promisify } from 'node:util';
import zlib from 'node:zlib';

import { fseqBlocks, writeFseq } from '../public/js/fseq.js';

const ZSTD_LEVEL = 19;  // 8 % smaller than level 10 on baked frames; downloads are made once, then kept
const ZLIB_LEVEL = 9;

// fn() without the experimental-zstd warning (Node warns once, on first use: the probe takes it).
function quietly(fn) {
  const emit = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type ?? warning?.name;
    if (type === 'ExperimentalWarning' && /zstd/i.test(String(warning?.message ?? warning))) return;
    return emit.call(this, warning, ...rest);
  };
  try { return fn(); } finally { process.emitWarning = emit; }
}

function probeZstd() {
  if (typeof zlib.zstdCompress !== 'function' || typeof zlib.zstdDecompressSync !== 'function') return false;
  try {
    return quietly(() => zlib.zstdDecompressSync(zlib.zstdCompressSync(Buffer.from('PSEQ'))).toString() === 'PSEQ');
  } catch { return false; }
}

export const HAS_ZSTD = probeZstd();
export const FSEQ_CODEC = HAS_ZSTD ? 'zstd' : 'zlib';
const zstd = HAS_ZSTD ? promisify(zlib.zstdCompress) : null;
const deflate = promisify(zlib.deflate);
const COMPRESS = {
  zstd: (b) => zstd(b, { params: { [zlib.constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL } }),
  zlib: (b) => deflate(b, { level: ZLIB_LEVEL }),
};

/** A parsed FSEQ as a compressed file: 80-frame blocks, compressed in the thread pool one at a time. */
export async function compressFseq(parsed, { codec = FSEQ_CODEC, blockFrames = 80, uniqueId } = {}) {
  if (!COMPRESS[codec] || (codec === 'zstd' && !HAS_ZSTD)) {
    throw new Error(`compressFseq: no ${codec} in this Node`);
  }
  const { data, channelCount, frameCount, stepMs, sparse, ranges, variables = {} } = parsed;
  const blocks = [];
  for (const [frame, count] of fseqBlocks(frameCount, blockFrames)) {
    const bytes = await COMPRESS[codec](data.subarray(frame * channelCount, (frame + count) * channelCount));
    blocks.push({ frame, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) });
  }
  return writeFseq({ frames: frameCount, stepMs, media: variables.mf, uniqueId,
    ...(sparse ? { ranges } : { channelCount }), compression: { type: codec, blocks } });
}

/** parseFseq's `decompress`: one block, at most `size` bytes (node:zlib throws past maxOutputLength). */
export function inflateBlock(codec, bytes, size) {
  const opts = { maxOutputLength: Math.max(1, size) };
  if (codec === 'zlib') return zlib.inflateSync(bytes, opts);
  if (codec === 'zstd' && HAS_ZSTD) return zlib.zstdDecompressSync(bytes, opts);
  throw new Error(`no ${codec} decoder in this Node`);
}
