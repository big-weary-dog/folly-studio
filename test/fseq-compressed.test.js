// Compressed FSEQ v2 (zstd = type 1, zlib = type 2): public/js/fseq.ts writes the block index,
// src/fseq-codec.js compresses, and src/frames.js parses strictly, refusing decompression bombs.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { describe, test } from 'vitest';

import { fseqBlocks, MAX_BLOCKS, writeFseq } from '../public/js/fseq.ts';
import { checkFrames } from '../src/box-output.ts';
import { FseqError, parseFseq } from '../src/frames.ts';
import { compressFseq, FSEQ_CODEC, HAS_ZSTD, inflateBlock } from '../src/fseq-codec.ts';
import { lineRig } from './fixtures/rigs.js';

const RANGES = [[0, 3], [510, 3]];
const C = 6;
const F = 203;
const data = new Uint8Array(F * C).map((_, i) => (i % C < 3 ? 40 + (i % 3) : Math.floor(i / C) & 255));
const plain = writeFseq({ frames: F, data, ranges: RANGES, media: 'song.mp3', uniqueId: 42 });
const CODECS = HAS_ZSTD ? ['zstd', 'zlib'] : ['zlib'];

/** The raw header fields, read independently of src/frames.js. */
function header(file) {
  const b = Buffer.from(file.buffer, file.byteOffset, file.length);
  const blocks = ((b[20] & 0xf0) << 4) | b[21];
  const index = [];
  for (let i = 0; i < blocks; i++) index.push([b.readUInt32LE(32 + 8 * i), b.readUInt32LE(36 + 8 * i)]);
  return { offset: b.readUInt16LE(4), headerLength: b.readUInt16LE(8), type: b[20] & 0x0f, blocks, index, b };
}

const rejects = (bytes, re, opts = { decompress: inflateBlock }) =>
  assert.throws(() => parseFseq(bytes, opts), (e) => e instanceof FseqError && re.test(e.message));

describe('compressed FSEQ', () => {
  test(`zstd when this Node has it (${FSEQ_CODEC} here); blocks of 80 frames, at most ${MAX_BLOCKS}`, () => {
    assert.equal(FSEQ_CODEC, HAS_ZSTD ? 'zstd' : 'zlib');
    assert.equal(HAS_ZSTD, typeof zlib.zstdCompressSync === 'function');
    assert.deepEqual(fseqBlocks(F), [[0, 80], [80, 80], [160, 43]]);
    assert.deepEqual(fseqBlocks(5), [[0, 5]]);
    const long = fseqBlocks(600 * 40);
    assert.ok(long.length <= MAX_BLOCKS && long[0][1] === 95, '600 s: fewer, bigger blocks');
    assert.equal(long.reduce((n, [, c]) => n + c, 0), 600 * 40);
  });

  for (const codec of CODECS) {
    test(`${codec}: header, block index and frames round-trip`, async () => {
      const file = await compressFseq(parseFseq(plain), { codec });
      const h = header(file);
      assert.equal(h.type, codec === 'zstd' ? 1 : 2);
      assert.equal(h.blocks, 3);
      assert.equal(h.headerLength, 32 + 8 * 3 + 6 * RANGES.length, 'block index, then sparse ranges');
      assert.equal(h.offset % 4, 0);
      assert.deepEqual(h.index.map(([frame]) => frame), [0, 80, 160], 'first frame of each block');
      assert.equal(h.index.reduce((n, [, len]) => n + len, 0), file.length - h.offset, 'then its compressed length');
      for (let i = 0, at = h.offset; i < 3; at += h.index[i++][1]) {
        const block = h.b.subarray(at, at + h.index[i][1]);
        // Each block is one whole zstd frame or zlib stream.
        const raw = codec === 'zstd' ? zlib.zstdDecompressSync(block) : zlib.inflateSync(block);
        const frames = (i < 2 ? 80 : 43);
        assert.deepEqual(new Uint8Array(raw), data.subarray(h.index[i][0] * C, (h.index[i][0] + frames) * C));
      }
      if (codec === 'zlib') assert.equal(h.b[h.offset], 0x78, 'a zlib stream, not raw deflate or gzip');
      const p = parseFseq(file, { decompress: inflateBlock });
      assert.equal(p.compression, codec);
      assert.equal(p.frameCount, F);
      assert.deepEqual(p.ranges, RANGES);
      assert.deepEqual(p.variables, { mf: 'song.mp3', sp: 'Folly Studio' });
      assert.deepEqual(p.data, data);
      assert.ok(file.length < plain.length);
    });
  }

  test('the writer checks its blocks', () => {
    const b = (frame) => ({ frame, bytes: new Uint8Array([1]) });
    const write = (blocks, type = 'zstd') => writeFseq({ frames: 10, ranges: RANGES, compression: { type, blocks } });
    assert.throws(() => write([b(0)], 'lz4'), /compression.type/);
    assert.throws(() => write([]), /1-255 blocks/);
    assert.throws(() => write([b(1)]), /ascend from 0/);
    assert.throws(() => write([b(0), b(0)]), /ascend from 0/);
    assert.throws(() => write([b(0), b(10)]), /below the frame count/);
    assert.throws(() => write([{ frame: 0, bytes: new Uint8Array(0) }]), /needs its bytes/);
    assert.throws(() => write(Array.from({ length: 256 }, (_, i) => b(i))), /1-255 blocks/);
    assert.equal(header(write([b(0), b(4)])).blocks, 2);
  });

  test('the parser takes compressed files only with a decompressor, and checks the index', async () => {
    const file = await compressFseq(parseFseq(plain), { codec: 'zlib' });
    rejects(file, /compressed files are not accepted here/, {});
    const edit = (fn) => {
      const b = Buffer.from(file);
      fn(b);
      return new Uint8Array(b);
    };
    rejects(edit((b) => b.writeUInt32LE(1, 32)), /block 1 does not follow the last/);
    rejects(edit((b) => b.writeUInt32LE(0, 40)), /block 2 does not follow the last/);
    rejects(edit((b) => b.writeUInt32LE(F, 48)), /block 3 starts past the last frame/);
    rejects(edit((b) => b.writeUInt32LE(b.readUInt32LE(36) + 1, 36)), /the block index says/);
    rejects(edit((b) => (b[21] = 0)), /lists no compression blocks/);
    rejects(edit((b) => (b[20] = 3)), /unknown compression type 3/);
    rejects(edit((b) => b.writeUInt16LE(32 + 6 * 2, 8)), /does not fit 3 compression blocks and 2 sparse ranges/);
    // Swapped blocks inflate to the wrong frame count.
    const h = header(file);
    const swapped = edit((b) => {
      b.writeUInt32LE(h.index[2][1], 44);
      b.writeUInt32LE(h.index[1][1], 52);
    });
    rejects(swapped, /does not inflate/);

    // FPP may leave empty entries at the end of the index: they are skipped. Nowhere else.
    const padded = (at) => {
      const b = Buffer.concat([h.b.subarray(0, at), Buffer.alloc(8), h.b.subarray(at)]);
      b.writeUInt16LE(h.offset + 8, 4);
      b.writeUInt16LE(h.headerLength + 8, 8);
      b[21] = 4;
      return new Uint8Array(b);
    };
    assert.deepEqual(parseFseq(padded(32 + 8 * 3), { decompress: inflateBlock }).data, data);
    rejects(padded(32 + 8), /block 3 follows an empty one/);
  });

  test('decompression bombs are refused before they go off', () => {
    // A tiny file claiming more channel data than allowed: refused without inflating anything.
    let calls = 0;
    const spy = (...a) => (calls++, inflateBlock(...a));
    const one = { frame: 0, bytes: zlib.deflateSync(Buffer.alloc(16)) };
    const huge = writeFseq({ frames: 100_000, channelCount: 40_800, compression: { type: 'zlib', blocks: [one] } });
    rejects(huge, /exceed the 67108864-byte limit/, { decompress: spy });
    assert.equal(calls, 0);
    rejects(huge, /exceed the 1000-byte limit/, { decompress: spy, maxDataBytes: 1000 });

    // A block that inflates far past its frames: node:zlib stops at the block's size.
    for (const codec of CODECS) {
      const zeros = Buffer.alloc(32 * 1024 * 1024);
      const bomb = codec === 'zstd' ? zlib.zstdCompressSync(zeros) : zlib.deflateSync(zeros, { level: 9 });
      assert.ok(bomb.length < 64 * 1024, `${codec} bomb is ${bomb.length} bytes`);
      const sizes = [];
      const compression = { type: codec, blocks: [{ frame: 0, bytes: bomb }] };
      const file = writeFseq({ frames: 80, ranges: RANGES, compression });
      const t0 = Date.now();
      rejects(file, /block 1 does not inflate to its 80 frames \(480 bytes\)/, {
        decompress: (c, b, size) => (sizes.push(size), inflateBlock(c, b, size)),
      });
      assert.deepEqual(sizes, [480]);
      assert.ok(Date.now() - t0 < 2000, 'stopped early');
    }
    // And one that holds less than it claims.
    const short = { frame: 0, bytes: zlib.deflateSync(Buffer.alloc(479)) };
    const compression = { type: 'zlib', blocks: [short] };
    rejects(writeFseq({ frames: 80, ranges: RANGES, compression }), /does not inflate/);
  });

  test('a box may hand back a compressed bake: checked like any other', async () => {
    const rig = { ...lineRig(2), output: { universes: 2, channelsPerUniverse: 510 } };
    rig.pixels = { ...rig.pixels, universe: [1, 2], channel: [1, 1] };
    const { bake } = checkFrames(await compressFseq(parseFseq(plain)), { source: 'fleet-box', rig });
    assert.equal(bake.status, 'done', bake.reason);
    assert.equal(bake.analysis.frames, F);
  });
});
