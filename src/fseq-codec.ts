// FSEQ v2 compression with node:zlib, for .fseq downloads and parseFseq's `decompress`: zstd (type 1)
// and zlib (type 2) as FPP and xLights write them, each block a whole zstd frame or zlib stream.

import { promisify } from 'node:util';
import zlib from 'node:zlib';

import { fseqBlocks, writeFseq } from '../core/fseq.ts';
import type { Parsed } from './frames.ts';
import { quietly } from './quietly.ts';

const ZSTD_LEVEL = 19;  // 8 % smaller than level 10 on baked frames; downloads are made once, then kept
const ZLIB_LEVEL = 9;

// Node warns that zstd is experimental once, on first use: this use takes it.
quietly(/zstd/i, () => zlib.zstdCompressSync(new Uint8Array(0)));

export const FSEQ_CODEC: Codec = 'zstd';
const zstd = promisify(zlib.zstdCompress);
const deflate = promisify(zlib.deflate);
const ZSTD_OPTS = { params: { [zlib.constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL } };
export type Codec = 'zstd' | 'zlib';
const COMPRESS: Record<Codec, (b: Uint8Array) => Promise<Buffer>> = {
  zstd: (b) => zstd(b, ZSTD_OPTS),
  zlib: (b) => deflate(b, { level: ZLIB_LEVEL }),
};
const COMPRESS_SYNC: Record<Codec, (b: Uint8Array) => Buffer> = {
  zstd: (b) => zlib.zstdCompressSync(b, ZSTD_OPTS),
  zlib: (b) => zlib.deflateSync(b, { level: ZLIB_LEVEL }),
};

/**
 * A parsed FSEQ as a compressed file, with its uniqueId: 80-frame blocks, compressed one at a time in the thread
 * pool, or on the calling thread with `sync` (the server's low-priority worker).
 */
export async function compressFseq(parsed: Parsed, { codec = FSEQ_CODEC, sync = false }:
  { codec?: Codec, sync?: boolean } = {}) {
  if (!COMPRESS[codec]) throw new Error(`compressFseq: no ${codec} codec`);
  const { data, channelCount, frameCount, stepMs, sparse, ranges, variables, uniqueId } = parsed;
  const blocks = [];
  for (const [frame, count] of fseqBlocks(frameCount, 80)) {
    const block = data.subarray(frame * channelCount, (frame + count) * channelCount);
    const bytes = sync ? COMPRESS_SYNC[codec](block) : await COMPRESS[codec](block);
    blocks.push({ frame, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) });
  }
  return writeFseq({ frames: frameCount, stepMs, media: variables.mf, uniqueId,
    ...(sparse ? { ranges } : { channelCount }), compression: { type: codec, blocks } });
}

/** parseFseq's `decompress`: one block, at most `size` bytes (node:zlib throws past maxOutputLength). */
export function inflateBlock(codec: string, bytes: Uint8Array, size: number) {
  const opts = { maxOutputLength: Math.max(1, size) };
  if (codec === 'zlib') return zlib.inflateSync(bytes, opts);
  if (codec === 'zstd') return zlib.zstdDecompressSync(bytes, opts);
  throw new Error(`no ${codec} decoder`);
}
