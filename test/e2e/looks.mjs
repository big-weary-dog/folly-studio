// Looks for the end-to-end run, rendered in-process with pattern-core.js and written with fseq.js:
// an address-test look that encodes each LED's identity in its colour, a zone-colour look, and a
// moving library pattern. Only our own patterns run here.
import { readFileSync } from 'node:fs';

import { compilePattern, prepareLayer, prepareScene, renderFrame, toChannels } from '../../public/js/pattern-core.js';
import { ledRanges, writeFseq } from '../../public/js/fseq.js';

const STUDIO = new URL('../../', import.meta.url);
export const cathedral = JSON.parse(readFileSync(new URL('public/data/cathedral.json', STUDIO), 'utf8'));
export const FULL = cathedral.universes * cathedral.channelsPerUniverse;

/** What the address look gives LED k: [R, G, B] bytes. */
export function identity(k) {
  const px = cathedral.pixels;
  return [k % 251, (px.zone[k] * 7) % 251, (px.strand[k] * 13) % 251];
}

// Time-invariant: R = global index, G = zone, B = strand, each mod 251 (exact through toChannels).
export const ADDRESS_CODE = `// Address test: every LED's identity in its colour.
function pixel(p, t, P) {
  return [(p.k % 251) / 255, ((p.zi * 7) % 251) / 255, ((p.strand * 13) % 251) / 255];
}`;

// Each top-level group its own colour, so a wrong address shows up as a wrong colour. Mini arch 5
// (left and right) is magenta: a sim that starts it at ch 1 rather than 403 repeats arch 1 in orange.
// Rose petals go round the hue wheel from petal 1 (red), so petal order and mirroring show.
export const ZONE_COLOURS = [
  ['main-arch', '#ff2020', 'main arches: red'], ['mini-arch', '#ff9000', 'mini arches 1-4: orange'],
  ['quad-arch', '#ffe000', 'quad arches: yellow'], ['spire-', '#20ff40', 'spires: green'],
  ['spirelet', '#00e0ff', 'spirelets: cyan'], ['canopy', '#3050ff', 'canopy: blue'],
  ['wash', '#c040ff', 'wash: violet'],
];
const MINI_FIVE = cathedral.strands.flatMap((s, i) => (/^Mini arch (left|right) 5$/.test(s.name) ? [i] : []));
export const ZONE_LABELS = [...ZONE_COLOURS.map(([, , label]) => label), 'mini arch 5: magenta',
  'rose petals: hue wheel from petal 1 = red'];
export const ZONE_CODE = `// Zone colours: one colour per group of zones.
const table = ${JSON.stringify(ZONE_COLOURS.map(([prefix, colour]) => [prefix, colour]))};
const colours = table.map(([prefix, colour]) => [prefix, hex(colour)]);
const miniFive = ${JSON.stringify(MINI_FIVE)};
function pixel(p, t, P) {
  if (p.petal >= 0) return hsv(p.petal / 16, 1, 1);
  if (miniFive.includes(p.strand)) return hex('#ff00c0');
  for (const [prefix, c] of colours) if (p.zone.startsWith(prefix)) return c;
  return [0, 0, 0];
}`;

export function libraryCode(name) {
  return readFileSync(new URL(`public/patterns/${name}.js`, STUDIO), 'utf8');
}

/**
 * Render a look's layers ([{ code, groups?, blend?, level?, params?, clips? }]) for `seconds` at
 * `fps` (one frame when seconds is 0): { frames, channels: Uint8Array(frames × 40,800), errors }.
 */
export function renderLook(layers, { seconds = 0, fps = 40, start = 0, gamma = 1, brightness = 1 } = {}) {
  const scene = prepareScene(cathedral);
  const prepared = layers.map((l, i) => prepareLayer(scene, { id: `l${i}`, groups: ['cathedral'], blend: 'add',
    level: 1, ...l }, compilePattern(l.code)));
  const frames = Math.max(1, Math.round(seconds * fps));
  const channels = new Uint8Array(frames * FULL);
  const errors = [];
  let rgb;
  for (let f = 0; f < frames; f++) {
    const r = renderFrame(scene, prepared, start + f / fps, rgb);
    rgb = r.rgb;
    if (r.errors?.length) errors.push(...r.errors.map((e) => ({ frame: f, ...e })));
    toChannels(scene, rgb, channels.subarray(f * FULL, (f + 1) * FULL), { gamma, brightness });
  }
  return { frames, fps, channels, errors };
}

/** FSEQ bytes: full 80 × 510-channel frames, or sparse (the LED map's 33 ranges, as bakes are). */
export function toFseq({ frames, fps, channels }, { sparse = false } = {}) {
  const stepMs = Math.round(1000 / fps);
  if (!sparse) return writeFseq({ channelCount: FULL, frames, stepMs, data: channels });
  const ranges = ledRanges(cathedral);
  const per = ranges.reduce((n, [, c]) => n + c, 0);
  const data = new Uint8Array(frames * per);
  for (let f = 0, at = 0; f < frames; f++) {
    for (const [s, c] of ranges) {
      data.set(channels.subarray(f * FULL + s, f * FULL + s + c), at);
      at += c;
    }
  }
  return writeFseq({ frames, stepMs, data, ranges });
}
