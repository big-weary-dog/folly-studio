// tools/sacn-play.ts: E1.31 (sACN) packets checked field by field against the ANSI E1.31-2018
// data packet layout (offsets written out here, independently of the tool's own table), the
// universe slicing of absolute channels, and every FSEQ form it plays.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import { ledRanges, writeFseq } from '../public/js/fseq.ts';
import { parseFseq } from '../src/frames.ts';
import { compressFseq, HAS_ZSTD } from '../src/fseq-codec.ts';
import {
  cidBytes, e131Packet, fillSlots, multicastAddress, parseArgs, play, readShow, SacnSender,
} from '../tools/sacn-play.ts';

const rig = JSON.parse(readFileSync(new URL('../public/data/rig.json', import.meta.url), 'utf8'));
const mini = JSON.parse(readFileSync(new URL('./fixtures/rigs/mini.json', import.meta.url), 'utf8'));

const CID = '6f1c2a3b-4d5e-4f60-8172-8394a5b6c7d8';
const u16 = (b, o) => (b[o] << 8) | b[o + 1];                    // E1.31 is big-endian ("network order")
const u32 = (b, o) => b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const FULL = 80 * 510;

/** A full frame whose every channel is distinct per universe: byte = (universe × 7 + channel) & 255. */
function patternFrame() {
  const f = new Uint8Array(FULL);
  for (let a = 0; a < FULL; a++) f[a] = ((Math.floor(a / 510) + 1) * 7 + (a % 510) + 1) & 255;
  return f;
}

describe('E1.31 data packet layout', () => {
  const p = e131Packet({ cid: CID, name: 'Folly Studio', priority: 100, universe: 39, sequence: 7 });

  test('root layer: preamble, postamble, ACN packet identifier, flags+length, vector, CID', () => {
    assert.equal(p.length, 638);
    assert.equal(u16(p, 0), 0x0010, 'preamble size');
    assert.equal(u16(p, 2), 0x0000, 'post-amble size');
    assert.deepEqual([...p.subarray(4, 16)], [...Buffer.from('ASC-E1.17\0\0\0', 'latin1')], 'ACN packet identifier');
    assert.equal(u16(p, 16), 0x7000 | (638 - 16), 'root flags (0x7) and PDU length from byte 16');
    assert.equal(u16(p, 16) >> 12, 0x7);
    assert.equal(u32(p, 18), 0x00000004, 'VECTOR_ROOT_E131_DATA');
    assert.deepEqual([...p.subarray(22, 38)], [...Buffer.from(CID.replace(/-/g, ''), 'hex')], 'CID');
  });

  test('framing layer: flags+length, vector, source name, priority, sync, sequence, options, universe', () => {
    assert.equal(u16(p, 38), 0x7000 | (638 - 38), 'framing flags and length from byte 38');
    assert.equal(u32(p, 40), 0x00000002, 'VECTOR_E131_DATA_PACKET');
    const name = p.subarray(44, 108);
    assert.equal(name.length, 64);
    assert.equal(Buffer.from(name.subarray(0, 12)).toString('utf8'), 'Folly Studio');
    assert.ok(name.subarray(12).every((v) => v === 0), 'NUL-padded to 64 bytes');
    assert.equal(p[108], 100, 'priority');
    assert.equal(u16(p, 109), 0, 'synchronization address: none');
    assert.equal(p[111], 7, 'sequence number');
    assert.equal(p[112], 0, 'options: not preview, not terminated, no force-sync');
    assert.equal(u16(p, 113), 39, 'universe');
  });

  test('DMP layer: flags+length, vector, address and data type, first address, increment, count, start code', () => {
    assert.equal(u16(p, 115), 0x7000 | (638 - 115), 'DMP flags and length from byte 115');
    assert.equal(p[117], 0x02, 'VECTOR_DMP_SET_PROPERTY');
    assert.equal(p[118], 0xa1, 'address type & data type');
    assert.equal(u16(p, 119), 0x0000, 'first property address');
    assert.equal(u16(p, 121), 0x0001, 'address increment');
    assert.equal(u16(p, 123), 513, 'property value count: start code + 512 slots');
    assert.equal(p[125], 0x00, 'DMX512 null start code');
    assert.ok(p.subarray(126).every((v) => v === 0), 'slots start dark');
  });

  test('source names stay NUL-terminated and whole characters; bad fields are refused', () => {
    const long = e131Packet({ cid: CID, name: 'é'.repeat(40), universe: 1 });
    const name = long.subarray(44, 108);
    assert.equal(name[63], 0, 'byte 64 is always the terminator');
    assert.equal(Buffer.from(name).toString('utf8').replace(/\0+$/, ''), 'é'.repeat(31), 'no split character');
    assert.throws(() => e131Packet({ cid: CID, universe: 0 }), /universe/);
    assert.throws(() => e131Packet({ cid: CID, universe: 64000 }), /universe/);
    assert.throws(() => e131Packet({ cid: CID, universe: 1, priority: 201 }), /priority/);
    assert.throws(() => cidBytes('not-a-uuid'), /CID/);
    assert.equal(cidBytes().length, 16);
  });

  test('multicast groups: 239.255.{high}.{low} of the universe', () => {
    assert.equal(multicastAddress(1), '239.255.0.1');
    assert.equal(multicastAddress(80), '239.255.0.80');
    assert.equal(multicastAddress(256), '239.255.1.0');
    assert.equal(multicastAddress(63999), '239.255.249.255');
  });
});

describe('universes from absolute channels', () => {
  test('universe u carries channels (u − 1) × 510 … + 509 in slots 1-510; slots 511-512 are zero', () => {
    const frame = patternFrame();
    for (const u of [1, 2, 39, 80]) {
      const p = fillSlots(e131Packet({ cid: CID, universe: u }), frame, u);
      for (const ch of [1, 2, 3, 403, 510]) {
        assert.equal(p[125 + ch], frame[(u - 1) * 510 + (ch - 1)], `u${u} ch${ch}`);
        assert.equal(p[125 + ch], (u * 7 + ch) & 255);
      }
      assert.equal(p[126 + 510], 0, 'slot 511');
      assert.equal(p[126 + 511], 0, 'slot 512');
    }
  });

  test('a frame shorter than the universe leaves the rest dark', () => {
    const p = e131Packet({ cid: CID, universe: 2 });
    p.fill(9, 126);
    fillSlots(p, new Uint8Array(600).fill(5), 2);
    assert.ok(p.subarray(126, 126 + 90).every((v) => v === 5));
    assert.ok(p.subarray(126 + 90).every((v) => v === 0));
  });

  test('a rig with 300 channels a universe fills 300 slots', () => {
    const cpu = mini.output.channelsPerUniverse, frame = Uint8Array.from({ length: 2 * cpu }, (_, a) => (a % 250) + 1);
    const p = fillSlots(e131Packet({ cid: CID, universe: 2 }), frame, 2, cpu);
    assert.equal(p[126], frame[cpu]);
    assert.equal(p[126 + cpu - 1], frame[2 * cpu - 1]);
    assert.ok(p.subarray(126 + cpu).every((v) => v === 0));
  });
});

describe('reading shows', () => {
  const frames = 3;
  const full = new Uint8Array(frames * FULL);
  for (let f = 0; f < frames; f++) full.set(patternFrame().map((v) => (v + f * 11) & 255), f * FULL);
  const ranges = ledRanges(rig);
  const sparseData = new Uint8Array(frames * ranges.reduce((n, [, c]) => n + c, 0));
  for (let f = 0, at = 0; f < frames; f++) {
    for (const [start, count] of ranges) {
      sparseData.set(full.subarray(f * FULL + start, f * FULL + start + count), at);
      at += count;
    }
  }
  const plain = writeFseq({ channelCount: FULL, frames, data: full });
  const sparse = writeFseq({ frames, data: sparseData, ranges });
  const used = new Uint8Array(FULL);
  for (const [s, c] of ranges) used.fill(1, s, s + c);

  test('a full file plays its frames as written', () => {
    const show = readShow(plain);
    assert.deepEqual([show.frames, show.fps, show.channels, show.sparse], [3, 40, FULL, false]);
    for (let f = 0; f < frames; f++) assert.deepEqual(show.frame(f), full.subarray(f * FULL, (f + 1) * FULL));
  });

  test('a sparse file is placed at its absolute channels, the rest dark', () => {
    const show = readShow(sparse);
    assert.equal(show.sparse, true);
    const out = new Uint8Array(FULL);
    for (let f = 0; f < frames; f++) {
      show.frame(f, out);
      for (let a = 0; a < FULL; a++) assert.equal(out[a], used[a] ? full[f * FULL + a] : 0);
    }
  });

  for (const codec of HAS_ZSTD ? ['zstd', 'zlib'] : ['zlib']) {
    test(`a ${codec}-compressed file plays the same bytes as the plain one`, async () => {
      const packed = await compressFseq(parseFseq(sparse), { codec });
      const show = readShow(packed);
      assert.equal(show.compression, codec);
      const plainShow = readShow(sparse);
      for (let f = 0; f < frames; f++) assert.deepEqual(show.frame(f), plainShow.frame(f));
    });
  }
});

describe('sending', () => {
  test('one packet per universe per frame, sequence numbers per universe, terminate sets bit 6', async () => {
    const rx = dgram.createSocket('udp4');
    await new Promise((resolve) => rx.bind(0, '127.0.0.1', resolve));
    const got = [];
    rx.on('message', (m) => got.push(Buffer.from(m)));
    const tx = dgram.createSocket('udp4');
    const sender = new SacnSender({ socket: tx, port: rx.address().port, cid: CID, universes: [7, 9] });
    const frame = patternFrame();
    for (let i = 0; i < 3; i++) sender.send(frame);
    sender.terminate(frame);
    for (let i = 0; i < 100 && got.length < 18; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    tx.close();
    rx.close();
    assert.equal(got.length, 18, '3 universes × (3 frames + 3 terminate packets)');
    assert.equal(sender.frames, 3);
    for (const u of [7, 8, 9]) {
      const mine = got.filter((p) => u16(p, 113) === u);
      assert.deepEqual(mine.map((p) => p[111]), [0, 1, 2, 3, 4, 5], `u${u} sequence`);
      assert.deepEqual(mine.map((p) => p[112]), [0, 0, 0, 0x40, 0x40, 0x40], `u${u} options`);
      for (const p of mine) {
        assert.equal(p.length, 638);
        assert.deepEqual(p.subarray(126, 636), Buffer.from(frame.subarray((u - 1) * 510, u * 510)));
      }
    }
  });

  test('play: once through then terminate, or hold one frame', async () => {
    const data = Uint8Array.from({ length: 24 }, (_, i) => i);
    const show = readShow(writeFseq({ channelCount: 6, frames: 4, data }));
    const log = [];
    const fake = { frames: 0, packets: 0, terminate: () => log.push('end'),
      send(f) { log.push(f[0]); this.frames++; } };
    await play(show, fake, { fps: 400 }).done;
    assert.deepEqual(log.filter((v) => v !== 'end').slice(0, 1), [0]);
    assert.equal(log.at(-1), 'end');
    assert.ok(log.filter((v) => typeof v === 'number').every((v, i, a) => i === 0 || v >= a[i - 1]), 'in order');
    log.length = 0;
    await play(show, fake, { hold: 2, seconds: 0.03, fps: 400 }).done;   // the first frame at once, then the end
    assert.ok(log.length >= 2 && log.slice(0, -1).every((v) => v === 12), 'frame 2 (first channel 12) only');
    assert.equal(log.at(-1), 'end');
    log.length = 0;                                     // and again and again: counted in ticks, not in time
    let ticks = 0;
    const held = play(show, fake, { hold: 2, fps: 400, onTick: () => ++ticks === 3 && held.stop() });
    await held.done;
    assert.deepEqual(log, [12, 12, 12, 'end']);
  });

  test('options: defaults, ranges and refusals', () => {
    const o = parseArgs(['show.fseq']);
    assert.deepEqual([o.host, o.port, o.universes, o.loop, o.hold, o.priority], ['127.0.0.1', 5568, null, false,
      null, 100], 'universes: all the rig\'s');
    assert.match(o.rig, /public\/data\/rig\.json$/);
    assert.equal(parseArgs(['a.fseq', '--rig', 'other.json']).rig, 'other.json');
    assert.deepEqual(parseArgs(['a.fseq', '--universes', '7-16', '--hold', '0', '--loop']).universes, [7, 16]);
    assert.deepEqual(parseArgs(['a.fseq', '--universes', '39']).universes, [39, 39]);
    assert.equal(parseArgs(['a.fseq', '--multicast']).multicast, true);
    for (const bad of [['a.fseq', '--universes', '0-3'], ['a.fseq', '--universes', '5-64000'], ['--loop'],
      ['a.fseq', '--priority', '300'], ['a.fseq', '--bogus']]) assert.throws(() => parseArgs(bad), /usage|--/);
  });
});
