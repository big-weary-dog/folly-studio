// FSEQ v2 compression with node:zlib: compressed .fseq downloads (src/frames-cache.js) and the
// `decompress` hook that lets parseFseq (src/frames.js, pure) read compressed files.
//
//   FSEQ_CODEC                         'zstd' when this Node has it (22.15+, 23.8+), else 'zlib'
//   compressFseq(parsed, { codec? }) → Promise<Uint8Array>   blocks of 2 s, compressed off-thread
//   inflateBlock(codec, bytes, size)  → Uint8Array(size)      throws past `size`: no bombs
//
// zstd is type 1 and zlib type 2 in the FSEQ header, as FPP and xLights write them: each block a
// whole zstd frame, or a whole zlib stream (RFC 1950, not raw deflate or gzip).

import { promisify } from 'node:util';
import zlib from 'node:zlib';

import { fseqBlocks, writeFseq } from '../public/js/fseq.js';

const ZSTD_LEVEL = 19;  // 8 % smaller than level 10 on baked frames; downloads are made once, then kept
const ZLIB_LEVEL = 9;

/**
 * Run fn with an experimental-zstd warning filtered out. Node warns once per process, on first use,
 * in the versions that flag zstd: the probe below takes that use, quietly, and other warnings show.
 */
function quietly(fn) {
  const emit = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type ?? warning?.name;
    if (type === 'ExperimentalWarning' && /zstd/i.test(String(warning?.message ?? warning))) return;
    return emit.call(this, warning, ...rest);
  };
  try {
    return fn();
  } finally {
    process.emitWarning = emit;
  }
}

function probeZstd() {
  if (typeof zlib.zstdCompress !== 'function' || typeof zlib.zstdDecompressSync !== 'function') return false;
  try {
    return quietly(() => zlib.zstdDecompressSync(zlib.zstdCompressSync(Buffer.from('PSEQ'))).toString() === 'PSEQ');
  } catch {
    return false;
  }
}

export const HAS_ZSTD = probeZstd();
export const FSEQ_CODEC = HAS_ZSTD ? 'zstd' : 'zlib';

const zstd = HAS_ZSTD ? promisify(zlib.zstdCompress) : null;
const deflate = promisify(zlib.deflate);
const COMPRESS = {
  zstd: (b) => zstd(b, { params: { [zlib.constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL } }),
  zlib: (b) => deflate(b, { level: ZLIB_LEVEL }),
};

/**
 * A parsed FSEQ (parseFseq) as a compressed FSEQ v2 file: 80-frame blocks (2 s at 40 fps), each
 * compressed in the thread pool, one at a time so the server stays responsive.
 */
export async function compressFseq(parsed, { codec = FSEQ_CODEC, blockFrames = 80, uniqueId } = {}) {
  if (!COMPRESS[codec] || (codec === 'zstd' && !HAS_ZSTD)) throw new Error(`compressFseq: no ${codec} in this Node`);
  const { data, channelCount, frameCount, stepMs, sparse, ranges, variables = {} } = parsed;
  const blocks = [];
  for (const [frame, count] of fseqBlocks(frameCount, blockFrames)) {
    const bytes = await COMPRESS[codec](data.subarray(frame * channelCount, (frame + count) * channelCount));
    blocks.push({ frame, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) });
  }
  return writeFseq({
    frames: frameCount, stepMs, media: variables.mf, uniqueId,
    ...(sparse ? { ranges } : { channelCount }),
    compression: { type: codec, blocks },
  });
}

/**
 * parseFseq's `decompress`: one block, at most `size` bytes out. node:zlib stops at
 * maxOutputLength and throws, so a small block claiming to hold gigabytes never gets that far.
 */
export function inflateBlock(codec, bytes, size) {
  const opts = { maxOutputLength: Math.max(1, size) };
  if (codec === 'zlib') return zlib.inflateSync(bytes, opts);
  if (codec === 'zstd' && HAS_ZSTD) return zlib.zstdDecompressSync(bytes, opts);
  throw new Error(`no ${codec} decoder in this Node`);
}
