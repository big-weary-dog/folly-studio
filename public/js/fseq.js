// FSEQ v2.0 writer (optional sparse ranges and compressed blocks) for xLights and FPP; runs in the
// browser and in Node. Layout, little-endian, after FPP's FSEQFile.cpp:
//   0 'PSEQ' · 4 u16 data offset (headers padded to 4) · 6 u8 minor 0 · 7 u8 major 2
//   8 u16 header length (32 + 8 × blocks + 6 × ranges) · 10 u32 channels · 14 u32 frames · 18 u8 step ms
//   19 u8 flags · 20 u8 compression (0 none, 1 zstd, 2 zlib; high nibble: block count bits 8-11)
//   21 u8 block count · 22 u8 range count · 23 reserved · 24 u64 unique id
//   32: blocks (u32 first frame, u32 bytes), ranges (u24 first channel, u24 count), variable headers
//   (u16 length, 2-char code, NUL-terminated text), then the frames back to back, or the blocks
//   (each a whole zstd frame or zlib stream). A sparse frame holds only its ranges' channels.
// At most 255 blocks, so byte 20's high nibble stays 0: readers differ on whether they honour it.

const FIXED_HEADER = 32;
const MAX_U24 = 0xffffff;
const COMPRESSION = { zstd: 1, zlib: 2 };
export const MAX_BLOCKS = 255;
const utf8 = (s) => new TextEncoder().encode(String(s));

/** Check sparse ranges ([[start, count], ...], ascending, not overlapping); returns their total. */
function rangeTotal(ranges) {
  if (!Array.isArray(ranges) || ranges.length > 255) {
    throw new Error('writeFseq: ranges must be an array of at most 255 [start, count] pairs');
  }
  let total = 0;
  let end = 0;
  for (const r of ranges) {
    const [start, count] = Array.isArray(r) ? r : [];
    const whole = Number.isInteger(start) && Number.isInteger(count);
    if (!whole || start < 0 || start > MAX_U24 || count < 1 || count > MAX_U24) {
      throw new Error('writeFseq: each range is [start, count]: whole numbers, start 0-16777215, '
        + 'count 1-16777215');
    }
    if (start < end) throw new Error('writeFseq: ranges must be in ascending order and must not overlap');
    end = start + count;
    total += count;
  }
  return total;
}

/** Each compression block's frames, [[firstFrame, count], ...]: `per` each, more to stay ≤ MAX_BLOCKS. */
export function fseqBlocks(frames, per = 80) {
  if (!(Number.isInteger(frames) && frames >= 1)) throw new Error('fseqBlocks: frames must be a whole number ≥ 1');
  const size = Math.max(1, Math.floor(per) || 1, Math.ceil(frames / MAX_BLOCKS));
  const out = [];
  for (let f = 0; f < frames; f += size) out.push([f, Math.min(size, frames - f)]);
  return out;
}

/** Check compressed blocks ([{ frame, bytes }], first frames ascending from 0); returns their total size. */
function blocksTotal(blocks, frames) {
  if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > MAX_BLOCKS) {
    throw new Error(`writeFseq: compression.blocks must hold 1-${MAX_BLOCKS} blocks`);
  }
  let prev = -1;
  let total = 0;
  for (const { frame, bytes } of blocks) {
    if (!Number.isInteger(frame) || frame <= prev || frame >= frames || (prev < 0 && frame !== 0)) {
      throw new Error('writeFseq: block first frames must ascend from 0 and stay below the frame count');
    }
    if (!(bytes instanceof Uint8Array) || bytes.length < 1) throw new Error('writeFseq: each block needs its bytes');
    prev = frame;
    total += bytes.length;
  }
  return total;
}

/**
 * writeFseq({ channelCount, frames, stepMs = 25, data, uniqueId?, media?, ranges?, compression? }) → Uint8Array.
 * `data`: frames × channelCount bytes. `media`: an audio file name ('mf'); 'sp' is always "Folly Studio".
 * `ranges` ([[start, count], ...], ascending) makes it sparse; channelCount is then their total.
 * `compression` ({ type: 'zstd' | 'zlib', blocks: [{ frame, bytes }] }) replaces `data`: each block is
 * its frames' channels (fseqBlocks), compressed by the caller (this module has no codecs).
 */
export function writeFseq({ channelCount, frames, stepMs = 25, data, uniqueId, media, ranges, compression } = {}) {
  const sparse = ranges !== undefined && ranges !== null && ranges.length !== 0;
  if (sparse) {
    const total = rangeTotal(ranges);
    if (channelCount === undefined) channelCount = total;
    else if (channelCount !== total) {
      throw new Error(`writeFseq: channelCount ${channelCount} is not the ranges' total ${total}`);
    }
  }
  if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 0xffffffff) {
    throw new Error('writeFseq: channelCount must be a whole number ≥ 1');
  }
  if (!Number.isInteger(frames) || frames < 0 || frames > 0xffffffff) {
    throw new Error('writeFseq: frames must be a whole number ≥ 0');
  }
  if (!Number.isInteger(stepMs) || stepMs < 1 || stepMs > 255) {
    throw new Error('writeFseq: stepMs must be a whole number of milliseconds, 1-255');
  }
  const type = compression ? COMPRESSION[compression.type] : 0;
  if (compression && !type) throw new Error("writeFseq: compression.type must be 'zstd' or 'zlib'");
  const blocks = type ? compression.blocks : [];
  let bytes;
  if (type) bytes = blocksTotal(blocks, frames);
  else {
    if (!(data instanceof Uint8Array)) throw new Error('writeFseq: data must be a Uint8Array');
    bytes = channelCount * frames;
    if (data.length !== bytes) {
      const want = `${frames} frames × ${channelCount} channels`;
      throw new Error(`writeFseq: data holds ${data.length} bytes, expected ${want} = ${bytes}`);
    }
  }

  const variables = [];
  if (media) variables.push(['mf', utf8(media)]);
  variables.push(['sp', utf8('Folly Studio')]);
  const varLength = variables.reduce((n, [, text]) => n + 4 + text.length + 1, 0);
  const headerLength = FIXED_HEADER + 8 * blocks.length + (sparse ? 6 * ranges.length : 0);
  const offset = (headerLength + varLength + 3) & ~3;
  if (offset > 0xffff) throw new Error('writeFseq: variable headers too long');

  const out = new Uint8Array(offset + bytes);
  const view = new DataView(out.buffer);
  out.set([0x50, 0x53, 0x45, 0x51, 0, 0, 0, 2]);     // 'PSEQ', offset (below), version 2.0
  view.setUint16(4, offset, true);
  view.setUint16(8, headerLength, true);
  view.setUint32(10, channelCount, true);
  view.setUint32(14, frames, true);
  out.set([stepMs, 0, type, blocks.length, sparse ? ranges.length : 0, 0], 18); // flags 0, reserved 0
  const id = uniqueId === undefined ? BigInt(Date.now()) * 1000n : BigInt(uniqueId);
  view.setBigUint64(24, BigInt.asUintN(64, id), true);

  let at = FIXED_HEADER;
  for (const block of blocks) {
    view.setUint32(at, block.frame, true);
    view.setUint32(at + 4, block.bytes.length, true);
    at += 8;
  }
  if (sparse) {
    for (const [start, count] of ranges) {
      out[at] = start & 255; out[at + 1] = (start >>> 8) & 255; out[at + 2] = (start >>> 16) & 255;
      out[at + 3] = count & 255; out[at + 4] = (count >>> 8) & 255; out[at + 5] = (count >>> 16) & 255;
      at += 6;
    }
  }
  for (const [code, text] of variables) {
    view.setUint16(at, 4 + text.length + 1, true);
    out[at + 2] = code.charCodeAt(0);
    out[at + 3] = code.charCodeAt(1);
    out.set(text, at + 4);
    out[at + 4 + text.length] = 0;
    at += 4 + text.length + 1;
  }
  if (!type) out.set(data, offset);
  for (let i = 0, o = offset; i < blocks.length; o += blocks[i++].bytes.length) out.set(blocks[i].bytes, o);
  return out;
}

/** The channels the LED map uses, as merged spans [[start, count], …]: what a sparse file holds. */
export function ledRanges(cathedral) {
  const cpu = cathedral.channelsPerUniverse || 510;
  const used = new Uint8Array((cathedral.universes || 80) * cpu);
  const { universe, channel } = cathedral.pixels;
  for (let k = 0; k < cathedral.count; k++) {
    const a = (universe[k] - 1) * cpu + (channel[k] - 1);
    if (a >= 0 && a + 2 < used.length) used[a] = used[a + 1] = used[a + 2] = 1;
  }
  const ranges = [];
  for (let c = 0; c < used.length; c++) {
    if (!used[c]) continue;
    const last = ranges[ranges.length - 1];
    if (last && last[0] + last[1] === c) last[1]++;
    else ranges.push([c, 1]);
  }
  return ranges;
}
