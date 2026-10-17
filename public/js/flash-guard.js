// flash-guard.js: watches the frames the Studio shows for large-area flashing, by the rule bakes are
// checked with (src/frames.js: WCAG 2.3.1 general flash on the whole and on each top-level group that
// is large), so the preview can dim a strobe as soon as it starts. Pure; nothing allocated per frame.
// test/flash-guard.test.js holds it to src/frames.js's verdicts.

import { pixelsForGroups, prepareScene } from './core/scene.js';

export const FLASH = Object.freeze({ delta: 0.1, darker: 0.8, perSecond: 3 });
export const LARGE = Object.freeze({ share: 0.1, extent: 0.1, grid: 32 });
const HOLD_MS = 2500;        // stays on this long after the last flashing second, so it does not blink
const SWINGS = 2 * FLASH.perSecond + 1;

/** The whole structure and each top-level group: [{ id, idx: Int32Array | null (all), large }]. */
export function guardRegions(cathedral) {
  const scene = prepareScene(cathedral);
  const root = scene.groups.find((g) => g.parent == null);
  const regions = [{ id: root ? root.id : 'cathedral', idx: null }];
  for (const g of scene.groups) {
    const idx = root && g.parent === root.id ? pixelsForGroups(scene, [g.id]) : [];
    if (idx.length) regions.push({ id: g.id, idx: Int32Array.from(idx) });
  }
  const large = largeRegions(cathedral, regions);
  return regions.map((r, j) => ({ ...r, large: large[j] }));
}

/** As src/frames.js: the whole, ≥ 10 % of the LEDs, or ≥ 10 % of the lit cells from the front or side. */
function largeRegions(cathedral, regions) {
  const N = cathedral.count | 0, pos = cathedral.pixels.pos;
  if (!pos || pos.length !== 3 * N) return regions.map((r) => !r.idx || r.idx.length >= LARGE.share * N);
  const axis = (a) => pos.filter((_, i) => i % 3 === a);
  const lo = [0, 1, 2].map((a) => cathedral.bounds?.min?.[a] ?? Math.min(...axis(a)));
  const hi = [0, 1, 2].map((a) => cathedral.bounds?.max?.[a] ?? Math.max(...axis(a)));
  const cell = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / LARGE.grid || 1;
  const at = (k, a) => Math.floor((pos[3 * k + a] - lo[a]) / cell);
  const area = (idx, [u, v]) => {
    const cells = new Set();
    for (let i = 0, n = idx ? idx.length : N; i < n; i++) {
      const k = idx ? idx[i] : i;
      cells.add(at(k, u) * 65536 + at(k, v));
    }
    return cells.size;
  };
  const views = [[2, 1], [0, 1]];
  const whole = views.map((view) => area(null, view));
  return regions.map((r) => !r.idx || r.idx.length >= LARGE.share * N
    || views.some((view, i) => area(r.idx, view) >= LARGE.extent * whole[i]));
}

/**
 * new FlashGuard(cathedral); guard.observe(rgb, ms) → true while a large region flashes more than
 * three times a second (and for a moment after). rgb: Float32Array(count × 3), 0..1, as shown.
 */
export class FlashGuard {
  constructor(cathedral) {
    this.regions = guardRegions(cathedral).filter((r) => r.large);
    const R = this.regions.length;
    this.count = cathedral.count | 0;
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

  observe(rgb, now) {
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

  feed(j, v, now) {
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
  swing(j, t, now) {
    const n = this.n[j]++, base = j * SWINGS;
    this.times[base + (n % SWINGS)] = t;
    if (n + 1 >= SWINGS && t - this.times[base + ((n + 1) % SWINGS)] < 1000) this.until = now + HOLD_MS;
  }
}

const lum = (rgb, k) => {
  const r = rgb[3 * k], g = rgb[3 * k + 1], b = rgb[3 * k + 2];
  return 0.2126 * (r < 0 ? 0 : r > 1 ? 1 : r) + 0.7152 * (g < 0 ? 0 : g > 1 ? 1 : g)
    + 0.0722 * (b < 0 ? 0 : b > 1 ? 1 : b);
};
