// Parses an FSEQ v2 file the way FPP/xLights do, without sharing any code with the writer (core/fseq.ts).
import assert from 'node:assert/strict';

/** The header, its ranges and variable headers, and `frame(i)`: an uncompressed file's frame i.
 * @param {Uint8Array} bytes */
export function readFseq(bytes) {
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
    variables: /** @type {Record<string, string>} */ ({}),
    ranges: /** @type {[number, number][]} */ ([]),
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
  const { dataOffset, channelCount } = h;
  const frame = (/** @type {number} */ i) => bytes.subarray(dataOffset + i * channelCount,
    dataOffset + (i + 1) * channelCount);
  return { ...h, frame };
}
