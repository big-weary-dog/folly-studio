// The rigs the suite runs on (SPEC "Rig"): City of Gods (the default, rig.json), the Folly's playa build
// (rig-folly.json), and a fictional mini rig (three strips, an 8 × 8 panel, four floods; z up, GRB, 2 universes of
// 300 channels, 30 fps) that proves nothing assumes the Folly.
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
export const cog = read('../../public/data/rig.json');
export const folly = read('../../public/data/rig-folly.json');
export const mini = read('./rigs/mini.json');
export const RIGS = Object.freeze({ cog, folly, mini });

/** A rig of n LEDs in a line on universe 1 (channels 1, 4, 7 …), all in one root group `cathedral`. */
export function lineRig(n) {
  const pos = Array.from({ length: n }, (_, k) => [0, k, 0]).flat();
  return { rig: 1, count: n, output: { universes: 1, channelsPerUniverse: 510 },
    bounds: { min: [0, 0, 0], max: [0, n - 1, 0] }, fixtures: [{ id: 'z', zone: 'z', start: 0, count: n }],
    pixels: { universe: Array(n).fill(1), channel: Array.from({ length: n }, (_, k) => 1 + 3 * k), pos },
    groups: [{ id: 'cathedral', name: 'Cathedral', parent: null, zones: ['z'] }] };
}
