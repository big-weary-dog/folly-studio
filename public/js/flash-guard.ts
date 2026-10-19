// flash-guard.ts: watches the frames the Studio shows for large-area flashing, by the rule bakes are
// checked with (src/frames.js: WCAG 2.3.1 general flash on the whole and on each top-level group that
// is large), so the preview can dim a strobe as soon as it starts. Pure; nothing allocated per frame.
// test/flash-guard.test.js holds it to src/frames.js's verdicts.

import type { Rig } from '../../shared/schemas/rig.ts';
import { flashRegions, prepareScene, type Region } from './core/scene.ts';

export const FLASH = Object.freeze({ delta: 0.1, darker: 0.8, perSecond: 3 });
const HOLD_MS = 2500;        // stays on this long after the last flashing second, so it does not blink
const SWINGS = 2 * FLASH.perSecond + 1;

/** The whole structure and each top-level group: [{ id, idx: Int32Array | null (all), large }]. */
export const guardRegions = (rig: Rig) => flashRegions(prepareScene(rig));

/**
 * new FlashGuard(rig); guard.observe(rgb, ms) → true while a large region flashes more than
 * three times a second (and for a moment after). rgb: Float32Array(count × 3), 0..1, as shown.
 */
export class FlashGuard {
  regions: Region[]; count: number; until = -Infinity;
  state: Int8Array; prev: Float64Array; ext: Float64Array; extAt: Float64Array; lo: Float64Array; hi: Float64Array;
  times: Float64Array; n: Int32Array;

  constructor(rig: Rig) {
    this.regions = guardRegions(rig).filter((r) => r.large);
    const R = this.regions.length;
    this.count = rig.count | 0;
    this.state = new Int8Array(R);            // 0 not moving yet, 1 rising, −1 falling
    this.prev = new Float64Array(R);          // the extreme the current swing started from
    this.ext = new Float64Array(R);           // the current swing's extreme so far
    this.extAt = new Float64Array(R);
    this.lo = new Float64Array(R);
    this.hi = new Float64Array(R);
    this.times = new Float64Array(R * SWINGS); // the last swings' times, a ring per region
    this.n = new Int32Array(R);
    this.reset();
  }

  reset() {
    this.state.fill(0);
    this.lo.fill(Infinity);
    this.hi.fill(-Infinity);
    this.n.fill(0);
    this.until = -Infinity;
  }

  observe(rgb: Float32Array, now: number) {
    const regions = this.regions, N = this.count;
    for (let j = 0; j < regions.length; j++) {
      const idx = regions[j].idx;
      let sum = 0;
      if (idx) {
        for (let i = 0; i < idx.length; i++) sum += lum(rgb, idx[i]);
        this.feed(j, sum / idx.length, now);
      } else {
        for (let k = 0; k < N; k++) sum += lum(rgb, k);
        this.feed(j, sum / N, now);
      }
    }
    return now < this.until;
  }

  feed(j: number, v: number, now: number) {
    const { delta } = FLASH, EPS = 1e-9, s = this.state[j];
    if (s === 0) {
      if (v < this.lo[j]) this.lo[j] = v;
      if (v > this.hi[j]) this.hi[j] = v;
      if (v - this.lo[j] >= delta - EPS) { this.state[j] = 1; this.prev[j] = this.lo[j]; }
      else if (this.hi[j] - v >= delta - EPS) { this.state[j] = -1; this.prev[j] = this.hi[j]; }
      else return;
    } else if (!(s === 1 ? v > this.ext[j] : v < this.ext[j])) {
      if (Math.abs(this.ext[j] - v) < delta - EPS) return;
      if (Math.min(this.prev[j], this.ext[j]) < FLASH.darker) this.swing(j, this.extAt[j], now);
      this.prev[j] = this.ext[j];
      this.state[j] = -s;
    }
    this.ext[j] = v;
    this.extAt[j] = now;
  }

  /** A confirmed swing at time t: flashing when the last SWINGS of them fit in one second. */
  swing(j: number, t: number, now: number) {
    const n = this.n[j]++, base = j * SWINGS;
    this.times[base + (n % SWINGS)] = t;
    if (n + 1 >= SWINGS && t - this.times[base + ((n + 1) % SWINGS)] < 1000) this.until = now + HOLD_MS;
  }
}

const lum = (rgb: Float32Array, k: number) => {
  const r = rgb[3 * k], g = rgb[3 * k + 1], b = rgb[3 * k + 2];
  return 0.2126 * (r < 0 ? 0 : r > 1 ? 1 : r) + 0.7152 * (g < 0 ? 0 : g > 1 ? 1 : g)
    + 0.0722 * (b < 0 ? 0 : b > 1 ? 1 : b);
};
