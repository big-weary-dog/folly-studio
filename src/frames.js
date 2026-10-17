// frames.js: data-only checks on baked frames (an FSEQ v2 file), for the trusted side.
//
// Pure ES module: no I/O, no Node APIs, and nothing here runs code. It parses bytes and
// measures light. Everything a box returns is untrusted, so trust comes only from these checks,
// computed here on the bytes themselves. (A copy also goes into the Fleet box so a worker can run
// the same checks on its own bake; that run is advisory, the server repeats it.)
//
//   parseFseq(bytes, { maxBytes, maxChannels }) → { version, channelCount, frameCount, stepMs, fps,
//                                                  ranges, sparse, variables, data }   (throws FseqError)
//   analyzeFrames(parsed, cathedral) → { frames, seconds, fps, channels, sparse, pixels, coverage,
//                                        peakBrightness, meanBrightness, darkFraction, estPeakAmps,
//                                        flicker: { maxHz, flaggedSeconds, regions, ok } }

export const CHANNELS_PER_UNIVERSE = 510;
export const UNIVERSES = 80;
export const MAX_CHANNELS = UNIVERSES * CHANNELS_PER_UNIVERSE; // 40,800
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

// Photosensitivity: WCAG 2.3.1's general flash threshold, adapted to a building. WCAG counts a
// flash as a pair of opposing changes in relative luminance of at least 10 % of the maximum,
// where the darker state is below 0.80, and fails more than three flashes in any one second when
// they cover a large enough area (25 % of a 10° field of view). We have no viewing geometry, so
// "large area" is approximated by the mean luminance of the whole cathedral and of each
// top-level group (arches, spires, rose window, ...): a flash has to move a whole region's
// average to count. The red-flash threshold is not checked.
export const FLASH = Object.freeze({ delta: 0.1, darker: 0.8, perSecond: 3 });
// Power: WS281x pixels draw about 20 mA per channel at full (60 mA for a white pixel) at 5 V.
// Real strips vary and the controller may cap white, so this is an estimate for sizing supplies.
export const AMPS_PER_CHANNEL = 0.02;
const DARK = 10; // a pixel is dark when every channel is below this (about 4 %)

export class FseqError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FseqError';
  }
}

const fail = (msg) => {
  throw new FseqError(`frames: ${msg}`);
};
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u24 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

function text(bytes) {
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  return new TextDecoder('utf-8').decode(bytes.subarray(0, Math.min(end, 256))).replace(/[\u0000-\u001f\u007f]/g, '');
}

/**
 * Strictly parse an FSEQ v2.x file: uncompressed only, header fields consistent with each other
 * and with the file size, sparse ranges ascending and within maxChannels. Returns a view of the
 * channel data, not a copy. Throws FseqError on anything else.
 */
export function parseFseq(input, { maxBytes = DEFAULT_MAX_BYTES, maxChannels = MAX_CHANNELS } = {}) {
  const b = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!b) fail('not a byte buffer');
  if (b.length > maxBytes) fail(`${b.length} bytes is over the ${maxBytes}-byte limit`);
  if (b.length < 32) fail('shorter than an FSEQ header');
  if (b[0] !== 0x50 || b[1] !== 0x53 || b[2] !== 0x45 || b[3] !== 0x51) fail('not an FSEQ file');
  const minor = b[6];
  const major = b[7];
  if (major !== 2) fail(`FSEQ version ${major}.${minor}: only 2.x is accepted`);
  const dataOffset = u16(b, 4);
  const headerLength = u16(b, 8);
  const channelCount = u32(b, 10);
  const frameCount = u32(b, 14);
  const stepMs = b[18];
  const compression = b[20] & 0x0f;
  const blocks = ((b[20] & 0xf0) << 4) | b[21];
  const rangeCount = b[22];
  if (compression !== 0) fail('compressed files are not accepted');
  if (blocks !== 0) fail('an uncompressed file lists compression blocks');
  if (headerLength !== 32 + 6 * rangeCount) fail(`header length ${headerLength} does not fit ${rangeCount} sparse ranges`);
  if (dataOffset < headerLength || dataOffset > b.length) fail(`channel data offset ${dataOffset} is outside the header or file`);
  if (stepMs < 1) fail('step time is 0 ms');
  if (channelCount < 1) fail('no channels');
  if (frameCount < 1) fail('no frames');

  const ranges = [];
  if (rangeCount) {
    let end = 0;
    let total = 0;
    for (let i = 0, at = 32; i < rangeCount; i++, at += 6) {
      const start = u24(b, at);
      const count = u24(b, at + 3);
      if (count < 1) fail(`sparse range ${i + 1} is empty`);
      if (start < end) fail(`sparse range ${i + 1} overlaps or is out of order`);
      if (start + count > maxChannels) fail(`sparse range ${i + 1} ends past channel ${maxChannels}`);
      ranges.push([start, count]);
      end = start + count;
      total += count;
    }
    if (total !== channelCount) fail(`channel count ${channelCount} is not the sparse ranges' total ${total}`);
  } else {
    if (channelCount > maxChannels) fail(`${channelCount} channels: at most ${maxChannels}`);
    ranges.push([0, channelCount]);
  }

  const variables = {};
  let at = headerLength;
  while (at + 4 <= dataOffset) {
    const len = u16(b, at);
    if (len === 0) break; // padding up to the channel data
    if (len < 4 || at + len > dataOffset) fail(`variable header at byte ${at} runs past the channel data`);
    const code = String.fromCharCode(b[at + 2], b[at + 3]);
    if (!/^[\x21-\x7e]{2}$/.test(code)) fail(`variable header at byte ${at} has no code`);
    if (Object.keys(variables).length < 16 && !(code in variables)) variables[code] = text(b.subarray(at + 4, at + len));
    at += len;
  }

  const expected = channelCount * frameCount;
  if (b.length - dataOffset !== expected) {
    fail(`holds ${b.length - dataOffset} bytes of channel data, expected ${frameCount} frames × ${channelCount} channels = ${expected}`);
  }
  return {
    version: `2.${minor}`,
    channelCount,
    frameCount,
    stepMs,
    fps: 1000 / stepMs,
    ranges,
    sparse: rangeCount > 0,
    variables,
    data: b.subarray(dataOffset),
  };
}

/** Pixel masks of the whole cathedral and of each top-level group (children of the root). */
function regionsOf(cathedral, N) {
  const groups = (Array.isArray(cathedral.groups) ? cathedral.groups : []).filter((g) => g && typeof g.id === 'string');
  const root = groups.find((g) => g.parent == null);
  const zoneIndex = new Map((cathedral.zones || []).map((z, i) => [z, i]));
  const { zone, strand, row } = cathedral.pixels;
  // Same membership rule as the pattern runtime: zone in zones OR strand in strands (AND row in
  // rows when given); a group with neither is the union of its children.
  const memo = new Map();
  const members = (g, seen) => {
    if (memo.has(g.id)) return memo.get(g.id);
    const mask = new Uint8Array(N);
    if (seen.has(g.id)) return mask;
    seen.add(g.id);
    const zones = new Set((g.zones || []).map((z) => (typeof z === 'number' ? z : zoneIndex.get(z))));
    const strands = new Set(g.strands || []);
    const rows = Array.isArray(g.rows) && g.rows.length ? new Set(g.rows) : null;
    if (zones.size || strands.size) {
      for (let k = 0; k < N; k++) {
        if ((zones.has(zone[k]) || strands.has(strand?.[k])) && (!rows || rows.has(row?.[k]))) mask[k] = 1;
      }
    } else {
      for (const c of groups) if (c.parent === g.id) for (const [k, v] of members(c, seen).entries()) if (v) mask[k] = 1;
    }
    memo.set(g.id, mask);
    return mask;
  };
  const out = [{ id: root ? root.id : 'cathedral', idx: null }]; // null: every pixel
  for (const g of groups) {
    if (!root || g.parent !== root.id) continue;
    const mask = members(g, new Set());
    let n = 0;
    for (let k = 0; k < N; k++) n += mask[k];
    if (!n) continue;
    const idx = new Int32Array(n);
    for (let k = 0, j = 0; k < N; k++) if (mask[k]) idx[j++] = k;
    out.push({ id: g.id, idx });
  }
  return out;
}

const round = (v, places) => Math.round(v * 10 ** places) / 10 ** places;

/**
 * Measure parsed frames on the cathedral's LED map (cathedral.json): brightness, power and
 * large-area flashing. One pass over frames × pixels with typed arrays and no allocation per
 * frame. Channels the file does not hold count as off.
 */
export function analyzeFrames(parsed, cathedral) {
  const { data, channelCount: cc, frameCount: F, stepMs, ranges } = parsed || {};
  if (!(data instanceof Uint8Array) || !(cc > 0) || !(F > 0) || !(stepMs > 0) || !Array.isArray(ranges)) {
    throw new TypeError('analyzeFrames: pass the result of parseFseq');
  }
  const px = cathedral && cathedral.pixels;
  const N = cathedral ? cathedral.count | 0 : 0;
  if (!px || N < 1 || !px.universe || px.universe.length !== N || !px.channel || px.channel.length !== N || !px.zone || px.zone.length !== N) {
    throw new TypeError('analyzeFrames: the cathedral has no LED map');
  }
  const cpu = cathedral.channelsPerUniverse || CHANNELS_PER_UNIVERSE;

  // Absolute channel → its byte within a frame (−1 when the file does not hold it).
  let size = 0;
  for (const [s, c] of ranges) size = Math.max(size, s + c);
  const where = new Int32Array(size).fill(-1);
  let off = 0;
  for (const [s, c] of ranges) for (let i = 0; i < c; i++) where[s + i] = off++;
  const oR = new Int32Array(N);
  const oG = new Int32Array(N);
  const oB = new Int32Array(N);
  let covered = 0;
  for (let k = 0; k < N; k++) {
    const a = (px.universe[k] - 1) * cpu + (px.channel[k] - 1);
    const at = (c) => (a >= 0 && a + c < size ? where[a + c] : -1);
    oR[k] = at(0);
    oG[k] = at(1);
    oB[k] = at(2);
    covered += (oR[k] >= 0) + (oG[k] >= 0) + (oB[k] >= 0);
  }

  // Flash detector per region: a swing is confirmed once luminance turns back by `delta` from
  // its extreme, so slow drift and small shimmer never count. Swings are stored by frame.
  const regions = regionsOf(cathedral, N);
  const R = regions.length;
  const { delta, darker, perSecond } = FLASH;
  const EPS = 1e-9;
  const state = new Int8Array(R); // 0 = not moving yet, 1 = rising, −1 = falling
  const prev = new Float64Array(R); // the extreme the current swing started from
  const ext = new Float64Array(R); // the current swing's extreme so far
  const extAt = new Int32Array(R);
  const lo = new Float64Array(R).fill(Infinity);
  const hi = new Float64Array(R).fill(-Infinity);
  const swings = new Int32Array(R * (F + 1));
  const nSwings = new Int32Array(R);
  const swing = (j, from, to, at) => {
    if (Math.min(from, to) < darker) swings[j * (F + 1) + nSwings[j]++] = at;
  };
  const feed = (j, v, f) => {
    const s = state[j];
    if (s === 0) {
      if (v < lo[j]) lo[j] = v;
      if (v > hi[j]) hi[j] = v;
      if (v - lo[j] >= delta - EPS) {
        state[j] = 1;
        prev[j] = lo[j];
        ext[j] = v;
        extAt[j] = f;
      } else if (hi[j] - v >= delta - EPS) {
        state[j] = -1;
        prev[j] = hi[j];
        ext[j] = v;
        extAt[j] = f;
      }
    } else if (s === 1 ? v > ext[j] : v < ext[j]) {
      ext[j] = v;
      extAt[j] = f;
    } else if (Math.abs(ext[j] - v) >= delta - EPS) {
      swing(j, prev[j], ext[j], extAt[j]);
      prev[j] = ext[j];
      state[j] = -s;
      ext[j] = v;
      extAt[j] = f;
    }
  };

  const lum = new Float32Array(N);
  let peak = 0;
  let total = 0;
  let dark = 0;
  for (let f = 0; f < F; f++) {
    const base = f * cc;
    let sum = 0;
    let lsum = 0;
    for (let k = 0; k < N; k++) {
      const r = oR[k] >= 0 ? data[base + oR[k]] : 0;
      const g = oG[k] >= 0 ? data[base + oG[k]] : 0;
      const b = oB[k] >= 0 ? data[base + oB[k]] : 0;
      sum += r + g + b;
      if (r < DARK && g < DARK && b < DARK) dark++;
      // Relative luminance. LED PWM values are already linear light, so no sRGB decoding.
      const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      lum[k] = y;
      lsum += y;
    }
    if (sum > peak) peak = sum;
    total += sum;
    feed(0, lsum / N, f);
    for (let j = 1; j < R; j++) {
      const idx = regions[j].idx;
      let s = 0;
      for (let i = 0; i < idx.length; i++) s += lum[idx[i]];
      feed(j, s / idx.length, f);
    }
  }
  for (let j = 0; j < R; j++) if (state[j] !== 0 && Math.abs(ext[j] - prev[j]) >= delta - EPS) swing(j, prev[j], ext[j], extAt[j]);

  // Any one-second window holding more than 2 × perSecond swings (> perSecond flashes) is flagged.
  const seconds = (F * stepMs) / 1000;
  const flaggedMask = new Uint8Array(Math.ceil(seconds) + 1);
  const flaggedRegions = [];
  let maxSwings = 0;
  for (let j = 0; j < R; j++) {
    const t = swings.subarray(j * (F + 1), j * (F + 1) + nSwings[j]);
    let flagged = false;
    for (let q = 0, i = 0; q < t.length; q++) {
      while ((t[q] - t[i]) * stepMs >= 1000) i++;
      const n = q - i + 1;
      if (n > maxSwings) maxSwings = n;
      if (n > 2 * perSecond) {
        flagged = true;
        for (let s = Math.floor((t[i] * stepMs) / 1000), e = Math.floor((t[q] * stepMs) / 1000); s <= e; s++) flaggedMask[s] = 1;
      }
    }
    if (flagged) flaggedRegions.push(regions[j].id);
  }
  const flaggedSeconds = [];
  for (let s = 0; s < flaggedMask.length; s++) if (flaggedMask[s]) flaggedSeconds.push(s);

  return {
    frames: F,
    seconds: round(seconds, 3),
    fps: round(1000 / stepMs, 2),
    channels: cc,
    sparse: parsed.sparse === true,
    pixels: N,
    coverage: round(covered / (3 * N), 3), // share of the LED map's channels the file holds
    peakBrightness: round(peak / (765 * N), 3), // brightest frame, as a share of all-white
    meanBrightness: round(total / (765 * N * F), 3),
    darkFraction: round(dark / (N * F), 3),
    estPeakAmps: round((peak / 255) * AMPS_PER_CHANNEL, 1),
    flicker: { maxHz: maxSwings / 2, flaggedSeconds, regions: flaggedRegions, ok: flaggedRegions.length === 0 },
  };
}

/** One line on a failed flicker check, for people. */
export function flickerReason(analysis) {
  const f = analysis && analysis.flicker;
  if (!f || f.ok) return '';
  const at = f.flaggedSeconds.slice(0, 6).map((s) => `${s} s`).join(', ') + (f.flaggedSeconds.length > 6 ? ', …' : '');
  return `Large-area flashing at up to ${f.maxHz} flashes a second (over ${FLASH.perSecond} is unsafe for photosensitive people) around ${at}, on ${f.regions.join(', ')}.`;
}
