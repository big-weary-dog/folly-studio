// The flash check (SPEC "Baked frames" > Checks, DESIGN §6): WCAG 2.3.1's general flash threshold, for a sculpture.
// The bake check (src/frames.ts) and the preview's guard (flash-guard.ts) both run it. Pure; nothing allocated per
// frame unless it records a report.
//
// Regions (the whole rig, each top-level group) watch their mean luminance for swings: a change of ≥ delta that then
// turns back by ≥ delta, a transition as WCAG counts one. A swing is credited to the parts that made it (the region's
// LEDs in each cell of a grid 1/32 of the bounds' diagonal) that changed by ≥ delta between its two extremes
// themselves, the darker side below `darker`; it is large when they cover ≥ `area` of the LEDs, or of the lit cells
// seen from the front or the side. Transitions are counted where they happen, per cell, and a flash is a pair of
// them: over `perSecond` in any second is flashing. So a wave that crosses the arches in turn flashes each place once
// a pass, where one mean over all the arches would rise and fall with each arch it crossed.
import { pixelsForGroups, type Scene } from './scene.ts';

/** WCAG 2.3.1 defaults: over 3 flashes in any second, swings of ≥ 10 % with the darker side below 0.8, over ≥ 10 % of
 * the rig (its LEDs, or its lit area from the front or the side). */
export const FLASH = Object.freeze({ perSecond: 3, delta: 0.1, darker: 0.8, area: 0.1 });
export type FlashLimits = { perSecond: number, delta: number, darker: number, area: number };
const GRID = 32, WINDOW = 1000, EPS = 1e-9;
const RANGE: Record<keyof FlashLimits, [number, number]> = {
  perSecond: [0.5, 20], delta: [0.01, 1], darker: [0.01, 1], area: [0.001, 1] };

/** Limits from partial settings, each held to a sane range (else its WCAG default). */
export function flashLimits(o?: Partial<FlashLimits> | null): FlashLimits {
  const out: FlashLimits = { ...FLASH };
  for (const k of Object.keys(RANGE) as (keyof FlashLimits)[]) {
    const v = o?.[k], [lo, hi] = RANGE[k];
    if (typeof v === 'number' && v >= lo && v <= hi) out[k] = v;
  }
  return out;
}

/** The regions that watch for swings: the whole rig (idx null), then each top-level group with LEDs. */
export function flashRegions(scene: Scene) {
  const root = scene.root;
  const regions: { id: string, idx: Int32Array | null }[] = [{ id: root ? root.id : 'all', idx: null }];
  for (const g of scene.groups) {
    const idx = root && g.parent === root.id ? pixelsForGroups(scene, [g.id]) : null;
    if (idx?.length) regions.push({ id: g.id, idx });
  }
  return regions;
}

/** Flashing found, by kind: the most flashes in any second, the seconds flagged, the top-level regions where. */
export type Flashes = { maxHz: number, flaggedSeconds: number[], regions: string[] };

/**
 * new FlashWatch(scene, limits?, { record }); watch.frame(lum, ms) per frame (lum: each LED's relative luminance
 * 0..1) → true when a large area has just been found flashing. With `record`, report() → { large, small }.
 */
export class FlashWatch {
  limits: FlashLimits; ids: string[]; flagged = false;
  private N: number; private K: number; private record: boolean; private epoch = 0;
  private leds: Int32Array[] = []; private partOf: Int32Array[] = []; private parts: Int32Array;
  private partCell: Int32Array; private partN: Float64Array; private sum: Float64Array; private v: Float64Array;
  private lo: Float64Array; private hi: Float64Array; private prev: Float64Array; private ext: Float64Array;
  private snapLo: Float64Array; private snapHi: Float64Array;
  private snapPrev: Float64Array; private snapExt: Float64Array;
  private regionN: Float64Array; private state: Int8Array; private extAt: Float64Array;
  private front: Int32Array; private side: Int32Array; private wholeFront: number; private wholeSide: number;
  private stampF: Int32Array; private stampS: Int32Array; private cellRegions: number[][];
  private last: Int8Array[]; private lastAt: Float64Array[]; private ring: Float64Array[]; private n: Int32Array[];
  private hist: number[][][];

  constructor(scene: Scene, limits?: Partial<FlashLimits> | null, { record = false } = {}) {
    this.limits = flashLimits(limits);
    this.K = Math.floor(2 * this.limits.perSecond) + 1;  // transitions within a second that make it flashing
    this.record = record;
    const N = this.N = scene.count, regions = flashRegions(scene);
    this.ids = regions.map((r) => r.id);
    const { min: lo, max: hi } = scene.bounds, P = [scene.X, scene.Y, scene.Z];
    const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / GRID || 1;
    const at = (k: number, a: number) => Math.min(127, Math.max(0, Math.floor((P[a][k] - lo[a]) / size)));
    const cells = new Map<number, number>(), fronts = new Map<number, number>(), sides = new Map<number, number>();
    const id = (m: Map<number, number>, key: number) => m.get(key) ?? (m.set(key, m.size), m.size - 1);
    const cellOf = new Int32Array(N), front: number[] = [], side: number[] = [];
    for (let k = 0; k < N; k++) {
      const x = at(k, 0), y = at(k, 1), z = at(k, 2), c = cellOf[k] = id(cells, (x * 128 + y) * 128 + z);
      front[c] = id(fronts, z * 128 + y);
      side[c] = id(sides, x * 128 + y);
    }
    const C = cells.size;
    this.front = Int32Array.from(front); this.side = Int32Array.from(side);
    this.wholeFront = fronts.size; this.wholeSide = sides.size;
    this.stampF = new Int32Array(fronts.size); this.stampS = new Int32Array(sides.size);
    // A part: one region's LEDs in one cell. A region's parts are consecutive.
    const parts: number[] = [], partCell: number[] = [], partN: number[] = [];
    this.cellRegions = Array.from({ length: C }, () => []);
    regions.forEach((r, j) => {
      const idx = r.idx ?? Int32Array.from({ length: N }, (_, k) => k), mine = new Map<number, number>();
      const of = new Int32Array(idx.length);
      idx.forEach((k, i) => {
        const c = cellOf[k];
        if (!mine.has(c)) { mine.set(c, partN.length); parts.push(j); partCell.push(c); partN.push(0); }
        partN[of[i] = mine.get(c)!]++;
      });
      if (j) for (const c of mine.keys()) this.cellRegions[c].push(j);
      this.leds.push(idx); this.partOf.push(of);
    });
    for (const list of this.cellRegions) if (!list.length) list.push(0);
    this.parts = Int32Array.from(parts); this.partCell = Int32Array.from(partCell);
    this.partN = Float64Array.from(partN);
    const F = () => new Float64Array(parts.length), R = regions.length;
    this.sum = F(); this.v = F(); this.snapLo = F(); this.snapHi = F(); this.snapPrev = F(); this.snapExt = F();
    this.regionN = Float64Array.from(regions, (r) => (r.idx ? r.idx.length : N));
    this.state = new Int8Array(R); this.extAt = new Float64Array(R);
    this.lo = new Float64Array(R); this.hi = new Float64Array(R); this.prev = new Float64Array(R);
    this.ext = new Float64Array(R);
    // Per cell and kind (0 large, 1 any): the last transition's direction and time, the last K times, how many.
    this.last = [new Int8Array(C), new Int8Array(C)];
    this.lastAt = [new Float64Array(C), new Float64Array(C)];
    this.ring = [new Float64Array(C * this.K), new Float64Array(C * this.K)];
    this.n = [new Int32Array(C), new Int32Array(C)];
    // Recording: per kind and cell, each counted transition's time and the region that saw it.
    this.hist = record ? [0, 1].map(() => Array.from({ length: C }, (): number[] => [])) : [];
    this.reset();
  }

  reset() {
    this.state.fill(0); this.lo.fill(Infinity); this.hi.fill(-Infinity);
    for (let i = 0; i < 2; i++) {
      this.last[i].fill(0); this.lastAt[i].fill(-Infinity); this.n[i].fill(0);
    }
    for (const h of this.hist) for (const list of h) list.length = 0;
    this.flagged = false;
  }

  /** One frame: lum[k] is LED k's relative luminance (0..1), at `ms`. True when a large area has just been found
   * flashing. */
  frame(lum: ArrayLike<number>, ms: number) {
    const sum = this.sum, v = this.v, partN = this.partN, parts = this.parts;
    this.flagged = false;
    sum.fill(0);
    for (let j = 0; j < this.leds.length; j++) {
      const idx = this.leds[j], of = this.partOf[j];
      for (let i = 0; i < idx.length; i++) sum[of[i]] += lum[idx[i]];
    }
    for (let p = 0; p < v.length; p++) v[p] = sum[p] / partN[p];
    for (let j = 0, p = 0; j < this.leds.length; j++) {
      const p0 = p;
      let total = 0;
      while (p < parts.length && parts[p] === j) total += sum[p++];
      this.feed(j, total / this.regionN[j], ms, p0, p);
    }
    return this.flagged;
  }

  /** Region j's mean x at ms (its parts p0..p1): a swing is confirmed once x turns back by delta from its extreme. */
  private feed(j: number, x: number, ms: number, p0: number, p1: number) {
    const s = this.state[j], delta = this.limits.delta;
    if (s === 0) {
      if (x < this.lo[j]) { this.lo[j] = x; copy(this.snapLo, this.v, p0, p1); }
      if (x > this.hi[j]) { this.hi[j] = x; copy(this.snapHi, this.v, p0, p1); }
      if (x - this.lo[j] >= delta - EPS) { this.state[j] = 1; this.prev[j] = this.lo[j]; }
      else if (this.hi[j] - x >= delta - EPS) { this.state[j] = -1; this.prev[j] = this.hi[j]; }
      else return;
      copy(this.snapPrev, this.state[j] === 1 ? this.snapLo : this.snapHi, p0, p1);
    } else if (!(s === 1 ? x > this.ext[j] : x < this.ext[j])) {
      if (Math.abs(this.ext[j] - x) < delta - EPS) return;
      this.swing(p0, p1, s, this.extAt[j]);
      this.prev[j] = this.ext[j];
      this.state[j] = -s;
      copy(this.snapPrev, this.snapExt, p0, p1);
    }
    this.ext[j] = x;
    this.extAt[j] = ms;
    copy(this.snapExt, this.v, p0, p1);
  }

  /** Did part p make the swing (direction d)? It changed by delta itself, its darker side below `darker`. */
  private made(p: number, d: number) {
    const a = this.snapPrev[p], b = this.snapExt[p];
    return (b - a) * d >= this.limits.delta - EPS && (a < b ? a : b) < this.limits.darker;
  }

  /** A region's swing (direction d, at its extreme t): credit the parts that made it, and judge their area. */
  private swing(p0: number, p1: number, d: number, t: number) {
    const e = ++this.epoch, area = this.limits.area;
    let leds = 0, front = 0, side = 0;
    for (let p = p0; p < p1; p++) {
      if (!this.made(p, d)) continue;
      const c = this.partCell[p];
      leds += this.partN[p];
      if (this.stampF[this.front[c]] !== e) { this.stampF[this.front[c]] = e; front++; }
      if (this.stampS[this.side[c]] !== e) { this.stampS[this.side[c]] = e; side++; }
    }
    const large = leds >= area * this.N || front >= area * this.wholeFront || side >= area * this.wholeSide;
    for (let p = p0; p < p1; p++) {
      if (!this.made(p, d)) continue;
      const c = this.partCell[p], j = this.parts[p];
      if (large && this.count(0, c, d, t, j)) this.flagged = true;
      this.count(1, c, d, t, j);
    }
  }

  /** A transition of cell c (kind 0 large, 1 any). Several regions may report the same one, each at its own extreme
   * and in any order, so only a later change of direction counts. True when the last K of them fit in a second. */
  private count(kind: number, c: number, d: number, t: number, j: number) {
    const last = this.last[kind], lastAt = this.lastAt[kind];
    if (last[c] === d || t <= lastAt[c]) return false;
    last[c] = d;
    lastAt[c] = t;
    const ring = this.ring[kind], K = this.K, n = this.n[kind][c]++;
    ring[c * K + (n % K)] = t;
    if (this.record) this.hist[kind][c].push(t, j);
    return n + 1 >= K && t - ring[c * K + ((n + 1) % K)] < WINDOW;
  }

  /** What was recorded (`record`), by kind: the most flashes in any second, the seconds flagged and where (the
   * top-level groups whose swings found it, else those it lies in). Small flashing is a place over the limit while no
   * large flashing covers it. */
  report(): { large: Flashes, small: Flashes } {
    const C = this.cellRegions.length, most = [0, 0];
    // Per kind: cell → its flagged seconds, and the regions that saw its flagged transitions.
    const flaggedAt = [0, 1].map(() => new Map<number, { seconds: Set<number>, where: Set<number> }>());
    for (let kind = 0; kind < 2; kind++) {
      for (let c = 0; c < C; c++) {
        const h = this.hist[kind]?.[c] ?? [];
        for (let q = 0, i = 0; q < h.length; q += 2) {
          while (h[q] - h[i] >= WINDOW) i += 2;
          most[kind] = Math.max(most[kind], (q - i) / 2 + 1);
          if ((q - i) / 2 + 1 < this.K) continue;
          const f = flaggedAt[kind].get(c) ?? flaggedAt[kind].set(c, { seconds: new Set(), where: new Set() }).get(c)!;
          for (let s = Math.floor(h[i] / WINDOW); s <= Math.floor(h[q] / WINDOW); s++) f.seconds.add(s);
          for (let x = i; x <= q; x += 2) if (h[x + 1]) f.where.add(h[x + 1]);
        }
      }
    }
    const summary = (kind: number, skip?: Map<number, { seconds: Set<number> }>): Flashes => {
      const seconds = new Set<number>(), where = new Set<number>();
      for (const [c, f] of flaggedAt[kind]) {
        const own = [...f.seconds].filter((s) => !skip?.get(c)?.seconds.has(s));
        for (const s of own) seconds.add(s);
        if (own.length) for (const j of f.where.size ? f.where : this.cellRegions[c]) where.add(j);
      }
      return { maxHz: most[kind] / 2, flaggedSeconds: [...seconds].sort((a, b) => a - b),
        regions: [...where].sort((a, b) => a - b).map((j) => this.ids[j]) };
    };
    return { large: summary(0), small: summary(1, flaggedAt[0]) };
  }
}

function copy(to: Float64Array, from: Float64Array, p0: number, p1: number) {
  for (let p = p0; p < p1; p++) to[p] = from[p];
}
