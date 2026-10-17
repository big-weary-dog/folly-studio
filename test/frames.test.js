// src/frames.js: the strict FSEQ parser and the frame analysis (brightness, power, flicker).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { writeFseq } from '../public/js/fseq.js';
import { analyzeFrames, FseqError, flickerReason, MAX_CHANNELS, parseFseq } from '../src/frames.js';

// 100 LEDs, 3 channels each: the body (zone 0) on universe 1, a small spire (zone 1, 5 LEDs) on
// universe 2. Top-level groups: body and spire.
function smallCathedral() {
  const N = 100;
  const px = { zone: [], strand: [], universe: [], channel: [], row: [], pos: [] };
  for (let k = 0; k < N; k++) {
    const spire = k >= 95;
    px.zone.push(spire ? 1 : 0);
    px.strand.push(spire ? 1 : 0);
    px.universe.push(spire ? 2 : 1);
    px.channel.push((spire ? k - 95 : k) * 3 + 1);
    px.row.push(0);
    px.pos.push(0, k / N, 0);
  }
  return {
    count: N,
    channelsPerUniverse: 510,
    universes: 80,
    zones: ['body', 'spire'],
    pixels: px,
    groups: [
      { id: 'cathedral', name: 'Cathedral', parent: null, zones: ['body', 'spire'] },
      { id: 'parts', name: 'Parts', parent: 'cathedral' }, // no zones: the union of its children
      { id: 'body', name: 'Body', parent: 'parts', zones: ['body'] },
      { id: 'spire', name: 'Spire', parent: 'cathedral', strands: [1] },
    ],
  };
}

/** The channels the LED map uses, as merged spans. */
function usedRanges(c) {
  const used = new Uint8Array(MAX_CHANNELS);
  for (let k = 0; k < c.count; k++) {
    const a = (c.pixels.universe[k] - 1) * 510 + c.pixels.channel[k] - 1;
    used[a] = used[a + 1] = used[a + 2] = 1;
  }
  const ranges = [];
  for (let i = 0; i < used.length; i++) {
    if (!used[i]) continue;
    const last = ranges.at(-1);
    if (last && last[0] + last[1] === i) last[1]++;
    else ranges.push([i, 1]);
  }
  return ranges;
}

/** Bake `seconds` at 40 fps; color(f, k) → [r, g, b] 0..255 per LED. Sparse unless full. */
function bake(c, seconds, color, { full = false } = {}) {
  const frames = Math.round(seconds * 40);
  const ranges = full ? null : usedRanges(c);
  const cc = full ? 2 * 510 : ranges.reduce((n, r) => n + r[1], 0);
  const at = new Int32Array(MAX_CHANNELS).fill(-1);
  if (full) for (let i = 0; i < cc; i++) at[i] = i;
  else for (let o = 0, r = 0; r < ranges.length; r++) for (let i = 0; i < ranges[r][1]; i++) at[ranges[r][0] + i] = o++;
  const data = new Uint8Array(frames * cc);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < c.count; k++) {
      const a = (c.pixels.universe[k] - 1) * 510 + c.pixels.channel[k] - 1;
      const [r, g, b] = color(f, k);
      data[f * cc + at[a]] = r;
      data[f * cc + at[a + 1]] = g;
      data[f * cc + at[a + 2]] = b;
    }
  }
  return writeFseq({ frames, data, ...(full ? { channelCount: cc } : { ranges }) });
}

const C = smallCathedral();
const gray = (v) => [v, v, v];
const square = (hz) => (f) => (Math.floor((f / 40) * hz * 2) % 2 ? 0 : 255);

describe('parseFseq', () => {
  test('sparse and full files round-trip through the writer', () => {
    const file = bake(C, 1, (f, k) => [f, k, 7]);
    const p = parseFseq(file);
    assert.equal(p.version, '2.0');
    assert.equal(p.sparse, true);
    assert.deepEqual(p.ranges, [[0, 285], [510, 15]]);
    assert.equal(p.channelCount, 300);
    assert.equal(p.frameCount, 40);
    assert.equal(p.stepMs, 25);
    assert.equal(p.fps, 40);
    assert.deepEqual(p.variables, { sp: 'Folly Studio' });
    assert.equal(p.data.length, 40 * 300);
    assert.deepEqual([...p.data.subarray(39 * 300, 39 * 300 + 3)], [39, 0, 7]);
    assert.equal(p.data.buffer, file.buffer, 'a view, not a copy');

    const full = parseFseq(bake(C, 0.5, () => gray(9), { full: true }));
    assert.equal(full.sparse, false);
    assert.deepEqual(full.ranges, [[0, 1020]]);
    assert.equal(parseFseq(full.data.buffer.slice(0)).frameCount, 20, 'an ArrayBuffer works too');
  });

  test('rejects truncated, malformed, oversized and compressed files', () => {
    const good = bake(C, 0.25, () => gray(1));
    const bad = (mutate) => {
      const b = good.slice();
      mutate(b, new DataView(b.buffer));
      return b;
    };
    const rejects = (bytes, re, opts) => assert.throws(() => parseFseq(bytes, opts), (e) => e instanceof FseqError && re.test(e.message));
    rejects(good.subarray(0, good.length - 1), /expected 10 frames × 300 channels/);
    rejects(new Uint8Array([...good, 0]), /expected 10 frames/);
    rejects(good.subarray(0, 20), /shorter than an FSEQ header/);
    rejects(bad((b) => (b[0] = 0x58)), /not an FSEQ file/);
    rejects(bad((b) => (b[7] = 1)), /version 1\.0: only 2\.x/);
    rejects(bad((b) => (b[20] = 1)), /compressed/);
    rejects(bad((b) => (b[20] = 0x02)), /compressed/);
    rejects(bad((b) => (b[21] = 1)), /compression blocks/);
    rejects(bad((b, v) => v.setUint16(8, 32, true)), /header length 32 does not fit 2 sparse ranges/);
    rejects(bad((b) => (b[22] = 3)), /header length/);
    rejects(bad((b, v) => v.setUint16(4, 40, true)), /offset 40 is outside the header/);
    rejects(bad((b, v) => v.setUint16(4, 0xfff0, true)), /outside the header or file/);
    rejects(bad((b) => (b[18] = 0)), /step time/);
    rejects(bad((b, v) => v.setUint32(14, 0, true)), /no frames/);
    rejects(bad((b, v) => v.setUint32(10, 0, true)), /no channels/);
    rejects(bad((b, v) => v.setUint32(10, 301, true)), /not the sparse ranges' total 300/);
    rejects(bad((b) => b.set([100, 0, 0], 38)), /overlaps or is out of order/); // second range starts at 100 < 285
    rejects(bad((b) => b.set([0, 0, 0, 0, 0, 0], 38)), /is empty/);
    rejects(bad((b) => b.set([0x9c, 0x9f, 0], 38)), /ends past channel 40800/); // starts at 40860
    rejects(bad((b, v) => v.setUint16(44, 200, true)), /runs past the channel data/);
    rejects(bad((b) => (b[46] = 0)), /has no code/);
    rejects(good, /over the 1000-byte limit/, { maxBytes: 1000 });
    rejects('PSEQ', /not a byte buffer/);
    const tooWide = writeFseq({ channelCount: MAX_CHANNELS + 1, frames: 1, data: new Uint8Array(MAX_CHANNELS + 1) });
    rejects(tooWide, /40801 channels: at most 40800/);
    rejects(writeFseq({ frames: 1, data: new Uint8Array(6), ranges: [[MAX_CHANNELS - 3, 6]] }), /ends past channel 40800/);
  });
});

describe('analyzeFrames', () => {
  test('flags a 10 Hz full-white strobe', () => {
    const a = analyzeFrames(parseFseq(bake(C, 5, (f) => gray(square(10)(f)))), C);
    assert.equal(a.flicker.ok, false);
    assert.equal(a.flicker.maxHz, 10);
    assert.deepEqual(a.flicker.flaggedSeconds, [0, 1, 2, 3, 4]);
    assert.deepEqual(a.flicker.regions, ['cathedral', 'parts', 'spire']);
    assert.match(flickerReason(a), /up to 10 flashes a second .* around 0 s, 1 s, 2 s, 3 s, 4 s, on cathedral, parts, spire/);
  });

  test('passes a slow 0.5 Hz breathe, 3 Hz exactly, and bright shimmer', () => {
    const breathe = analyzeFrames(parseFseq(bake(C, 10, (f) => gray(Math.round(127.5 - 127.5 * Math.cos(Math.PI * (f / 40)))))), C);
    assert.equal(breathe.flicker.ok, true);
    assert.ok(breathe.flicker.maxHz <= 1, `${breathe.flicker.maxHz}`);
    assert.deepEqual(breathe.flicker.flaggedSeconds, []);
    assert.equal(flickerReason(breathe), '');
    // WCAG's limit is more than three flashes a second.
    assert.equal(analyzeFrames(parseFseq(bake(C, 4, (f) => gray(square(3)(f)))), C).flicker.ok, true);
    assert.equal(analyzeFrames(parseFseq(bake(C, 4, (f) => gray(square(4)(f)))), C).flicker.ok, false);
    // Changes that never go darker than 0.8 relative luminance are not flashes.
    const shimmer = analyzeFrames(parseFseq(bake(C, 3, (f) => gray(f % 2 ? 255 : 220))), C);
    assert.equal(shimmer.flicker.ok, true);
    // Small changes (under 10 % of full) are not flashes either.
    assert.equal(analyzeFrames(parseFseq(bake(C, 3, (f) => gray(f % 2 ? 100 : 80))), C).flicker.ok, true);
  });

  test('a strobe on a small top-level group is flagged on that region alone', () => {
    const a = analyzeFrames(parseFseq(bake(C, 3, (f, k) => (k >= 95 ? gray(square(8)(f)) : gray(60)))), C);
    assert.equal(a.flicker.ok, false);
    assert.deepEqual(a.flicker.regions, ['spire'], 'a 5 % strobe barely moves the whole-cathedral mean');
    assert.equal(a.flicker.maxHz, 8);
  });

  test('brightness, darkness, power and coverage', () => {
    const white = analyzeFrames(parseFseq(bake(C, 1, (f) => gray(f < 20 ? 255 : 0))), C);
    assert.equal(white.frames, 40);
    assert.equal(white.seconds, 1);
    assert.equal(white.fps, 40);
    assert.equal(white.pixels, 100);
    assert.equal(white.coverage, 1);
    assert.equal(white.peakBrightness, 1);
    assert.equal(white.meanBrightness, 0.5);
    assert.equal(white.darkFraction, 0.5);
    assert.equal(white.estPeakAmps, 6, '100 LEDs × 3 channels × 20 mA');
    const red = analyzeFrames(parseFseq(bake(C, 0.5, () => [255, 0, 0])), C);
    assert.equal(red.peakBrightness, 0.333);
    assert.equal(red.estPeakAmps, 2);
    // A file holding only universe 1 leaves the spire's channels out (and dark).
    const part = writeFseq({ frames: 1, data: new Uint8Array(285).fill(255), ranges: [[0, 285]] });
    const a = analyzeFrames(parseFseq(part), C);
    assert.equal(a.coverage, 0.95);
    assert.equal(a.darkFraction, 0.05);
    assert.throws(() => analyzeFrames(parseFseq(part), { count: 0 }), /no LED map/);
    assert.throws(() => analyzeFrames({}, C), /parseFseq/);
  });

  test('on the real LED map: a 20 s sparse bake is about 12 MB, full frames about 33 MB', { skip: !fs.existsSync(new URL('../public/data/cathedral.json', import.meta.url)) && 'no cathedral.json' }, () => {
    const real = JSON.parse(fs.readFileSync(new URL('../public/data/cathedral.json', import.meta.url), 'utf8'));
    const ranges = usedRanges(real);
    const cc = ranges.reduce((n, r) => n + r[1], 0);
    assert.equal(cc, real.count * 3);
    const file = writeFseq({ frames: 800, data: new Uint8Array(800 * cc).fill(255), ranges });
    assert.ok(file.length < 12e6 && file.length > 11e6, `${file.length}`);
    assert.ok(800 * MAX_CHANNELS > 32e6);
    const a = analyzeFrames(parseFseq(file), real);
    assert.equal(a.coverage, 1);
    assert.equal(a.estPeakAmps, Math.round(real.count * 3 * 0.02 * 10) / 10);
    assert.equal(a.flicker.ok, true);
  });
});
