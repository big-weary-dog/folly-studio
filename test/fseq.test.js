// fseq.js: FSEQ v2.0 uncompressed (full or sparse), read back with an independent little reader.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { writeFseq } from '../public/js/fseq.js';

// Parses an FSEQ v2 file the way FPP/xLights do, without sharing any code with the writer.
function readFseq(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const h = {
    magic: buf.toString('latin1', 0, 4),
    dataOffset: buf.readUInt16LE(4),
    minor: buf[6],
    major: buf[7],
    headerLength: buf.readUInt16LE(8),
    channelCount: buf.readUInt32LE(10),
    frameCount: buf.readUInt32LE(14),
    stepMs: buf[18],
    flags: buf[19],
    compression: buf[20] & 0x0f,
    blocks: ((buf[20] & 0xf0) << 4) | buf[21],
    sparseRanges: buf[22],
    reserved: buf[23],
    uniqueId: buf.readBigUInt64LE(24),
    variables: {},
    ranges: [],
  };
  for (let i = 0, at = 32 + 8 * h.blocks; i < h.sparseRanges; i++, at += 6) {
    h.ranges.push([buf.readUIntLE(at, 3), buf.readUIntLE(at + 3, 3)]);
  }
  let at = h.headerLength;
  while (at + 4 <= h.dataOffset) {
    const len = buf.readUInt16LE(at);
    if (len < 4) break;
    const code = buf.toString('latin1', at + 2, at + 4);
    const raw = buf.subarray(at + 4, at + len);
    assert.equal(raw[raw.length - 1], 0, `variable header ${code} is NUL-terminated`);
    h.variables[code] = raw.subarray(0, raw.length - 1).toString('utf8');
    at += len;
  }
  h.frame = (i) => bytes.subarray(h.dataOffset + i * h.channelCount, h.dataOffset + (i + 1) * h.channelCount);
  return h;
}

test('header, variable headers and frames round-trip', () => {
  const channelCount = 40800, frames = 5;
  const data = new Uint8Array(channelCount * frames);
  for (let i = 0; i < data.length; i++) data[i] = (i * 31 + (i >> 8)) & 255;
  const file = writeFseq({ channelCount, frames, stepMs: 25, data, uniqueId: 1234567890123n });
  const h = readFseq(file);
  assert.equal(h.magic, 'PSEQ');
  assert.equal(h.major, 2);
  assert.equal(h.minor, 0);
  assert.equal(h.headerLength, 32);
  assert.equal(h.channelCount, channelCount);
  assert.equal(h.frameCount, frames);
  assert.equal(h.stepMs, 25);
  assert.equal(h.flags, 0);
  assert.equal(h.compression, 0);
  assert.equal(h.blocks, 0);
  assert.equal(h.sparseRanges, 0);
  assert.equal(h.reserved, 0);
  assert.equal(h.uniqueId, 1234567890123n);
  assert.deepEqual(h.variables, { sp: 'Folly Studio' });
  assert.equal(h.dataOffset % 4, 0, 'channel data starts on a multiple of 4');
  assert.equal(h.dataOffset, 52);                      // 32 + (4 + "Folly Studio\0") = 49 → 52
  assert.equal(file.length, h.dataOffset + channelCount * frames);
  for (let f = 0; f < frames; f++) {
    assert.deepEqual(h.frame(f), data.subarray(f * channelCount, (f + 1) * channelCount));
  }
});

test('media header, defaults, odd sizes', () => {
  const data = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const file = writeFseq({ channelCount: 3, frames: 2, data, media: 'song.mp3' });
  const h = readFseq(file);
  assert.equal(h.stepMs, 25, 'default 40 fps');
  assert.deepEqual(h.variables, { mf: 'song.mp3', sp: 'Folly Studio' });
  assert.equal(h.dataOffset % 4, 0);
  assert.deepEqual(Array.from(h.frame(1)), [4, 5, 6]);
  assert.ok(h.uniqueId > 0n);
  const empty = readFseq(writeFseq({ channelCount: 40800, frames: 0, data: new Uint8Array(0) }));
  assert.equal(empty.frameCount, 0);
});

test('rejects bad input', () => {
  assert.throws(() => writeFseq({ channelCount: 3, frames: 2, data: new Uint8Array(5) }),
    /expected 2 frames × 3 channels/);
  assert.throws(() => writeFseq({ channelCount: 0, frames: 1, data: new Uint8Array(0) }), /channelCount/);
  assert.throws(() => writeFseq({ channelCount: 3, frames: 1, stepMs: 0, data: new Uint8Array(3) }), /stepMs/);
  assert.throws(() => writeFseq({ channelCount: 3, frames: 1, data: [1, 2, 3] }), /Uint8Array/);
});

test('sparse ranges: header, ranges and frames round-trip', () => {
  const ranges = [[0, 336], [510, 336], [3060, 672], [40800 - 6, 6]];
  const channelCount = ranges.reduce((n, [, c]) => n + c, 0);
  const frames = 3;
  const data = new Uint8Array(channelCount * frames);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7 + 3) & 255;
  const file = writeFseq({ frames, data, ranges, uniqueId: 7n });
  const h = readFseq(file);
  assert.equal(h.sparseRanges, 4);
  assert.equal(h.headerLength, 32 + 6 * 4);
  assert.deepEqual(h.ranges, ranges);
  assert.equal(h.channelCount, channelCount, 'a sparse frame holds only the ranged channels');
  assert.deepEqual(h.variables, { sp: 'Folly Studio' });
  assert.equal(h.dataOffset % 4, 0);
  assert.equal(file.length, h.dataOffset + channelCount * frames);
  for (let f = 0; f < frames; f++) assert.deepEqual(h.frame(f), data.subarray(f * channelCount,
    (f + 1) * channelCount));
  // 24-bit fields hold big values; an explicit matching channelCount is fine.
  const wide = readFseq(writeFseq({ channelCount: 70000, frames: 1, data: new Uint8Array(70000), ranges: [[0x123456,
    70000]] }));
  assert.deepEqual(wide.ranges, [[0x123456, 70000]]);
  // No ranges (or an empty list) is the plain full-frame file.
  assert.equal(readFseq(writeFseq({ channelCount: 3, frames: 1, data: new Uint8Array(3), ranges: [] })).headerLength,
    32);
});

test('rejects bad sparse ranges', () => {
  const d = new Uint8Array(10);
  assert.throws(() => writeFseq({ frames: 1, data: d, ranges: [[5, 5], [0, 5]] }), /ascending/);
  assert.throws(() => writeFseq({ frames: 1, data: d, ranges: [[0, 6], [5, 4]] }), /overlap/);
  assert.throws(() => writeFseq({ frames: 1, data: d, ranges: [[0, 0], [5, 10]] }), /\[start, count\]/);
  assert.throws(() => writeFseq({ frames: 1, data: d, ranges: [[2 ** 24, 10]] }), /start 0-16777215/);
  assert.throws(() => writeFseq({ channelCount: 9, frames: 1, data: d, ranges: [[0, 10]] }),
    /not the ranges' total 10/);
  assert.throws(() => writeFseq({ frames: 1, data: d, ranges: Array.from({ length: 256 }, (_, i) => [i * 2, 1]) }),
    /at most 255/);
  assert.throws(() => writeFseq({ frames: 2, data: d, ranges: [[0, 10]] }), /expected 2 frames × 10 channels/);
});
