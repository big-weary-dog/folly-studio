// src/frames.ts: the strict FSEQ parser and the frame analysis (brightness, power, flicker).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import { ledRanges, writeFseq } from '../public/js/fseq.ts';
import {
  compileLayer, FlashWatch, ledLight, pixelsForGroups, prepareLayer, prepareLook, prepareScene, renderFrame,
} from '../public/js/pattern-core.ts';
import { checkFrames, flashSettings } from '../src/box-output.ts';
import { configOf } from '../src/config.ts';
import { analyzeFrames, FseqError, flickerReason, flickerWarning, MAX_CHANNELS, parseFseq } from '../src/frames.ts';
import { folly } from './fixtures/rigs.js';

// 100 LEDs, 3 channels each: the body (zone body) on universe 1, a small spire (5 LEDs) on universe 2.
// Top-level groups: parts (the body) and the spire.
function smallRig() {
  const N = 100;
  const px = { universe: [], channel: [], pos: [] };
  for (let k = 0; k < N; k++) {
    const spire = k >= 95;
    px.universe.push(spire ? 2 : 1);
    px.channel.push((spire ? k - 95 : k) * 3 + 1);
    px.pos.push(0, k / N, 0);
  }
  return {
    rig: 1, count: N, output: { universes: 80, channelsPerUniverse: 510 },
    bounds: { min: [0, 0, 0], max: [0, 0.99, 0] }, pixels: px,
    fixtures: [{ id: 'body', zone: 'body', start: 0, count: 95 }, { id: 'spire', zone: 'spire', start: 95, count: 5 }],
    groups: [
      { id: 'cathedral', name: 'Cathedral', parent: null, zones: ['body', 'spire'] },
      { id: 'parts', name: 'Parts', parent: 'cathedral' }, // no zones: the union of its children
      { id: 'body', name: 'Body', parent: 'parts', zones: ['body'] },
      { id: 'spire', name: 'Spire', parent: 'cathedral', fixtures: ['spire'] },
    ],
  };
}

/** analyzeFrames on a rig, as the server calls it (limits: the flash check's, FLASH by default). */
function analyze(parsed, rig, limits) {
  const scene = prepareScene(rig);
  return analyzeFrames(parsed, scene, new FlashWatch(scene, limits, { record: true }), ledLight());
}
const usedRanges = ledRanges;

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

const C = smallRig();
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
    const rejects = (bytes, re, opts) => assert.throws(() => parseFseq(bytes, opts),
      (e) => e instanceof FseqError && re.test(e.message));
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
    rejects(writeFseq({ frames: 1, data: new Uint8Array(6), ranges: [[MAX_CHANNELS - 3, 6]] }),
      /ends past channel 40800/);
  });
});

describe('analyzeFrames', () => {
  test('flags a 10 Hz full-white strobe', () => {
    const a = analyze(parseFseq(bake(C, 5, (f) => gray(square(10)(f)))), C);
    assert.equal(a.flicker.ok, false);
    assert.equal(a.flicker.maxHz, 10);
    assert.deepEqual(a.flicker.flaggedSeconds, [0, 1, 2, 3, 4]);
    assert.deepEqual(a.flicker.regions, ['parts', 'spire'], 'the 5-LED spire flashes with the rest: one large area');
    assert.deepEqual(a.flicker.small.regions, []);
    assert.deepEqual(a.flicker.limits, { perSecond: 3, delta: 0.5, area: 0.25 });
    assert.match(flickerReason(a),
      /up to 10 flashes a second \(over 3 .* around 0 s, 1 s, 2 s, 3 s, 4 s, on parts, spire\./);
  });

  test('passes a slow 0.5 Hz breathe, 3 Hz exactly, bright shimmer and swings under half the light', () => {
    const breathe = analyze(parseFseq(bake(C, 10,
      (f) => gray(Math.round(127.5 - 127.5 * Math.cos(Math.PI * (f / 40)))))), C);
    assert.equal(breathe.flicker.ok, true);
    assert.ok(breathe.flicker.maxHz <= 1, `${breathe.flicker.maxHz}`);
    assert.deepEqual(breathe.flicker.flaggedSeconds, []);
    assert.equal(flickerReason(breathe), '');
    // WCAG's limit is more than three flashes a second.
    assert.equal(analyze(parseFseq(bake(C, 4, (f) => gray(square(3)(f)))), C).flicker.ok, true);
    assert.equal(analyze(parseFseq(bake(C, 4, (f) => gray(square(4)(f)))), C).flicker.ok, false);
    // Changes that never go darker than 0.8 relative luminance are not flashes.
    const shimmer = analyze(parseFseq(bake(C, 3, (f) => gray(f % 2 ? 255 : 220))), C);
    assert.equal(shimmer.flicker.ok, true);
    // Swings under half the LEDs' light are not flashes either: 0.20 ↔ 0.35 is 3 % ↔ 10 % of it, 0.90 ↔ 0.99 is
    // 79 % ↔ 98 %. Each is measured in light, so with a tenth as the limit the bright one flashes and the dim one not.
    const dim = bake(C, 3, (f) => gray(square(5)(f) ? 89 : 51));
    const bright = bake(C, 3, (f) => gray(square(5)(f) ? 252 : 230));
    assert.equal(analyze(parseFseq(dim), C).flicker.ok, true);
    assert.equal(analyze(parseFseq(bright), C).flicker.ok, true);
    assert.equal(analyze(parseFseq(dim), C, { delta: 0.1 }).flicker.ok, true);
    assert.equal(analyze(parseFseq(bright), C, { delta: 0.1 }).flicker.ok, false);
    // An LED's light is its brightest channel: full red, blue or orange flashing is a full swing.
    for (const c of [[255, 0, 0], [0, 0, 255], [255, 128, 0]]) {
      assert.equal(analyze(parseFseq(bake(C, 3, (f) => (square(5)(f) ? c : gray(0)))), C).flicker.ok, false, `${c}`);
    }
    // A swing of half the light: 0.3 ↔ 0.9 (7 % ↔ 79 %).
    assert.equal(analyze(parseFseq(bake(C, 3, (f) => gray(square(5)(f) ? 230 : 77))), C).flicker.ok, false);
  });

  test('a strobe on a small top-level group alone is a warning, not a block', () => {
    const a = analyze(parseFseq(bake(C, 3, (f, k) => (k >= 95 ? gray(square(8)(f)) : gray(60)))), C);
    assert.equal(a.flicker.ok, true, 'a 5 % strobe barely moves the whole-cathedral mean');
    assert.deepEqual(a.flicker.regions, []);
    assert.deepEqual(a.flicker.small, { maxHz: 8, flaggedSeconds: [0, 1, 2], regions: ['spire'] });
    assert.equal(flickerReason(a), '');
    assert.match(flickerWarning(a), /small parts only \(spire\) at up to 8 flashes a second around 0 s, 1 s, 2 s/);
    assert.equal(flickerWarning(analyze(parseFseq(bake(C, 1, () => gray(60))), C)), '');
  });

  test('brightness, darkness, power and coverage', () => {
    const white = analyze(parseFseq(bake(C, 1, (f) => gray(f < 20 ? 255 : 0))), C);
    assert.equal(white.frames, 40);
    assert.equal(white.seconds, 1);
    assert.equal(white.fps, 40);
    assert.equal(white.pixels, 100);
    assert.equal(white.coverage, 1);
    assert.equal(white.peakBrightness, 1);
    assert.equal(white.meanBrightness, 0.5);
    assert.equal(white.darkFraction, 0.5);
    assert.equal(white.estPeakAmps, 6, '100 LEDs × 3 channels × 20 mA');
    const red = analyze(parseFseq(bake(C, 0.5, () => [255, 0, 0])), C);
    assert.equal(red.peakBrightness, 0.333);
    assert.equal(red.estPeakAmps, 2);
    // In the LEDs' light (v^2.2): half the code is about a fifth of the light, and 0.06 is dark.
    const grey = analyze(parseFseq(bake(C, 0.5, () => gray(128))), C);
    assert.equal(grey.peakBrightness, 0.22);
    assert.equal(grey.meanBrightness, 0.22);
    assert.equal(grey.estPeakAmps, 1.3);
    assert.equal(grey.darkFraction, 0);
    assert.equal(analyze(parseFseq(bake(C, 0.5, () => gray(15))), C).darkFraction, 1);
    // A file holding only universe 1 leaves the spire's channels out (and dark).
    const part = writeFseq({ frames: 1, data: new Uint8Array(285).fill(255), ranges: [[0, 285]] });
    const a = analyze(parseFseq(part), C);
    assert.equal(a.coverage, 0.95);
    assert.equal(a.darkFraction, 0.05);
  });

  test('on the Folly: a 20 s sparse bake is about 12 MB, full frames about 33 MB', () => {
    const real = folly;
    const ranges = usedRanges(real);
    const cc = ranges.reduce((n, r) => n + r[1], 0);
    assert.equal(cc, real.count * 3);
    const file = writeFseq({ frames: 800, data: new Uint8Array(800 * cc).fill(255), ranges });
    assert.ok(file.length < 12e6 && file.length > 11e6, `${file.length}`);
    assert.ok(800 * MAX_CHANNELS > 32e6);
    const a = analyze(parseFseq(file), real);
    assert.equal(a.coverage, 1);
    assert.equal(a.estPeakAmps, Math.round(real.count * 3 * 0.02 * 10) / 10);
    assert.equal(a.flicker.ok, true);
  });
});

describe('flicker on the Folly: large regions block, small ones warn', () => {
  const real = folly, scene = prepareScene(real);
  const strobeOn = (id) => {
    const inside = new Set(pixelsForGroups(scene, [id]));
    return analyze(parseFseq(bake(real, 2, (f, k) => (inside.has(k) ? gray(square(8)(f)) : gray(40)))), real);
  };

  test('large: ≥ 25 % of the LEDs, or ≥ 25 % of the lit area from the front or side', () => {
    const verdict = (id) => {
      const a = strobeOn(id);
      return !a.flicker.ok ? 'blocks' : a.flicker.small.regions.length ? 'warns' : 'passes';
    };
    const ids = ['arches', 'spires', 'spirelets', 'rose-window', 'canopy', 'wash'];
    assert.deepEqual(Object.fromEntries(ids.map((id) => [id, verdict(id)])), { arches: 'blocks', spires: 'blocks',
      spirelets: 'warns', 'rose-window': 'warns', canopy: 'blocks', wash: 'warns' });
  });

  test('the 20 spirelets or the rose window strobing: a warning the curator sees', () => {
    const spirelets = strobeOn('spirelets');
    assert.equal(spirelets.flicker.ok, true);
    assert.deepEqual(spirelets.flicker.small.regions, ['spirelets']);
    assert.match(flickerWarning(spirelets), /small parts only \(spirelets\)/);
    const rose = strobeOn('rose-window');
    assert.equal(rose.flicker.ok, true, 'a 6 m disc is under a quarter of the rig, front or side');
    assert.deepEqual(rose.flicker.small.regions, ['rose-window']);
  });
});

describe('flash check on looks: a wave a second is fine, a strobe is not', () => {
  const real = folly, scene = prepareScene(real);
  /** `seconds` of layers rendered by the core, baked as bytes and checked. */
  const check = (layers, seconds = 4) => {
    const prepared = layers.map((l) => prepareLayer(scene, l, compileLayer(l)));
    const look = prepareLook({}), frames = [];
    for (let f = 0; f < seconds * 40; f++) frames.push(renderFrame(scene, prepared, f / 40, null, look).rgb);
    const byte = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    return analyze(parseFseq(bake(real, seconds, (f, k) => [0, 1, 2].map((c) => byte(frames[f][3 * k + c])))), real);
  };
  const lib = (name) => readFileSync(new URL(`../public/patterns/${name}.js`, import.meta.url), 'utf8');
  // The Shockwave preset: a comet ring heading out of the rose, `every` seconds, `duty` thick.
  const shockwave = (every, duty = 0.5, groups) => ({ id: 's', groups, modules: [
    { id: 'b', kind: 'source', code: lib('bars'),
      params: { direction: 'in', speed: -1 / every, bars: 1, profile: 'comet', duty } },
    { id: 'e', kind: 'filter', code: lib('edge-fade'), params: { direction: 'in', position: 0.2, width: 0.8 } },
    { id: 'a', kind: 'warp', code: lib('anchor'), params: { shape: 'sphere' } }] });
  const strobe = (hz) => `function pixel(p, t) { return floor(t * ${hz} * 2) % 2 ? 0 : 1; }`;
  const passes = (a, what) => {
    assert.equal(a.flicker.ok, true, `${what}: ${flickerReason(a)}`);
    assert.deepEqual(a.flicker.small.regions, [], `${what}: ${flickerWarning(a)}`);
  };

  test('shockwaves and pulses at 1 and 2 Hz pass, on the whole Folly and from the rose', () => {
    for (const every of [1, 0.5]) {
      passes(check([shockwave(every)]), `shockwave every ${every} s`);
      passes(check([shockwave(every, 0.6, ['rose-window'])]),
        `shockwave on the rose every ${every} s`);
    }
    for (const hz of [1, 2]) {
      passes(check([{ id: 'p', code: `function pixel(p, t) { return pulse(fract(t * ${hz}), 0.25); }` }]),
        `a full white pulse at ${hz} Hz`);
    }
  });

  test('a 5 Hz strobe over everything blocks; on the spirelets alone it warns', () => {
    const all = check([{ id: 'x', code: strobe(5) }], 2);
    assert.equal(all.flicker.ok, false);
    assert.equal(all.flicker.maxHz, 5);
    const small = check([{ id: 'x', code: strobe(5), groups: ['spirelets'] }], 2);
    assert.equal(small.flicker.ok, true);
    assert.deepEqual(small.flicker.small.regions, ['spirelets']);
    assert.equal(small.flicker.small.maxHz, 5);
  });
});

describe('the flash check\'s settings', () => {
  test('from the config: FLASH by default, each limit only in range, and off for local use', () => {
    const defaults = { check: true, perSecond: 3, delta: 0.5, darker: 0.8, area: 0.25 };
    assert.deepEqual(flashSettings(configOf({})), defaults);
    const env = (perSecond, delta, area) => ({ STUDIO_FLASH_PER_SECOND: perSecond, STUDIO_FLASH_DELTA: delta,
      STUDIO_FLASH_AREA: area });
    assert.deepEqual(flashSettings(configOf(env('5', '0.2', '.1'))),
      { ...defaults, perSecond: 5, delta: 0.2, area: 0.1 });
    assert.deepEqual(flashSettings(configOf(env('30', '0', '7'))), defaults);
    assert.throws(() => configOf(env('lots', '0', '7')), /STUDIO_FLASH_PER_SECOND must be a number/);
    assert.equal(flashSettings(configOf({ STUDIO_FLASH_CHECK: 'off' })).check, false);
    assert.equal(flashSettings(configOf({ STUDIO_FLASH_CHECK: 'on' })).check, true);
  });

  test('checked frames use them; with the check off, large-area flashing is only a warning', () => {
    const bytes = bake(C, 2, (f) => gray(square(4)(f)));
    const strict = checkFrames(bytes, { source: 'render-box', rig: C, flash: flashSettings(configOf({})) }).bake;
    assert.equal(strict.ok, false);
    assert.match(strict.reason, /up to 4 flashes a second \(over 3 /);
    const relaxed = checkFrames(bytes, { source: 'render-box', rig: C,
      flash: flashSettings(configOf({ STUDIO_FLASH_PER_SECOND: '4' })) }).bake;
    assert.equal(relaxed.ok, true);
    assert.deepEqual(relaxed.analysis.flicker.limits, { perSecond: 4, delta: 0.5, area: 0.25 });
    const off = checkFrames(bytes, { source: 'render-box', rig: C,
      flash: flashSettings(configOf({ STUDIO_FLASH_CHECK: 'off' })) }).bake;
    assert.equal(off.ok, true);
    assert.equal(off.analysis.flicker.ok, false, 'still measured');
    assert.match(off.warning, /^The flash check is off on this server\. Large-area flashing at up to 4 flashes/);
  });
});
