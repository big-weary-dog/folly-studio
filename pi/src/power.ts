// The rose's expansion and the power compressor, frame by frame: the lighting repo's pixel-map/expand-fseq.py
// (expand_frames) and compress-fseq.py (compress) in the same arithmetic, so a frame comes out byte for byte as those
// tools would write it (pi/test/power.test.ts). Tables: pi/data/power.json (pi/tools/build_power.py). No allocation
// per frame.

/** pi/data/power.json. */
export type PowerTable = {
  pixels: number, channels: number, cellChannels: number, sets: string, weights: Record<string, number>,
  releaseFrames: number,
  petals: { src: number, exp: number, segments: [skip: number, cell: number, count: number][] }[],
  psus: { id: string, set: string, volts: number, rating: number,
    ranges: [start: number, bytes: number, watts: number][] }[],
};
/** compress-fseq.py's options: the port cap it runs at, headroom × each PSU's rating, the generator's DC watts. */
export type PowerOptions = { cap: number, headroom: number, gen: number };
export const COG_POWER: PowerOptions = { cap: 0.8, headroom: 1, gen: 5240 };   // city-of-gods/Makefile

/** ADD_LIVE_APP.md's self-check: the rig has the pixels lighting's pixel map has (pi/tools/build_power.py counted
 * them), or one of the two is stale and the engine must not start. */
export function checkPixels(rig: { name: string, count: number, pixels: { universe: unknown[] } }, table: PowerTable) {
  const listed = rig.pixels.universe.length;
  if (rig.count !== table.pixels || listed !== rig.count) {
    throw new Error(`rig ${rig.name} has ${rig.count} px (${listed} listed) but lighting's pixel map has `
      + `${table.pixels}: a stale map, run npm run build-data and pi/tools/build_power.py`);
  }
}

/** expand_frames for one frame: `out` (table.channels or more) gets `cells` as is and each petal's LEDs its cell's
 * colour; passage LEDs, never written, stay dark. */
export function expandRose(table: PowerTable, cells: Uint8Array, out: Uint8Array) {
  out.set(cells);
  for (const p of table.petals) {
    let idx = 0;
    // Indexed, not destructured: no iterator per segment per frame.
    for (let i = 0, segs = p.segments; i < segs.length; i++) {
      const seg = segs[i]!, cell = seg[1], count = seg[2];
      idx += seg[0];
      const src = p.src + cell * 3, r = cells[src]!, g = cells[src + 1]!, b = cells[src + 2]!;
      for (let k = 0, o = p.exp + idx * 3; k < count; k++, o += 3) { out[o] = r; out[o + 1] = g; out[o + 2] = b; }
      idx += count;
    }
  }
}

// CPython's sum() of floats (3.12+): Neumaier's compensated sum, the compensation added at the end if finite.
let sumF = 0, sumC = 0;
const sumStart = () => { sumF = 0; sumC = 0; };
const sumAdd = (x: number) => {
  const t = sumF + x;
  sumC += Math.abs(sumF) >= Math.abs(x) ? (sumF - t) + x : (x - t) + sumF;
  sumF = t;
};
const sumEnd = () => (sumC && Number.isFinite(sumC) ? sumF + sumC : sumF);

/**
 * compress() for a stream of expanded frames: Rule 2 (each Bright Set's gain so no PSU passes its rating at the cap),
 * Rule 3 (the generator budget, spread A > B > C > D), instant attack and a slow release, applied in place.
 * apply(frame) → whether it cut; `stats` as compress-fseq.py reports them.
 */
export function powerLimiter(table: PowerTable, o: PowerOptions = COG_POWER) {
  const sets = [...table.sets], S = sets.length, psus = table.psus, P = psus.length;
  const setOf = Int32Array.from(psus, (p) => sets.indexOf(p.set));
  const weights = Float64Array.from(sets, (s) => table.weights[s]!);
  const psuW = new Float64Array(P), g2 = new Float64Array(S), g3 = new Float64Array(S), setW = new Float64Array(S);
  const gPrev = new Float64Array(S).fill(1), lut = new Uint8Array(256);
  const rel = 1 / table.releaseFrames;
  const stats = { frames: 0, compressedFrames: 0, minGain: Object.fromEntries(sets.map((s) => [s, 1])),
    genPeakW: 0, lastGenW: 0, gains: gPrev };

  function rule3(budget: number) {
    sumStart();
    for (let s = 0; s < S; s++) sumAdd(setW[s]!);
    const total = sumEnd();
    if (total <= budget || total <= 0) { g3.fill(1); return; }
    const excess = total - budget;
    let lo = 0, hi = 1e9;
    for (let i = 0; i < 60; i++) {
      const k = (lo + hi) / 2;
      sumStart();
      for (let s = 0; s < S; s++) sumAdd(setW[s]! * Math.min(1, k * weights[s]!));
      if (sumEnd() < excess) lo = k; else hi = k;
    }
    for (let s = 0; s < S; s++) g3[s] = 1 - Math.min(1, hi * weights[s]!);
  }

  function apply(fr: Uint8Array) {
    for (let p = 0; p < P; p++) {
      sumStart();
      for (let r = 0, ranges = psus[p]!.ranges; r < ranges.length; r++) {
        const range = ranges[r]!;
        let sum = 0;
        for (let i = range[0], end = i + range[1]; i < end; i++) sum += fr[i]!;
        sumAdd(sum * range[2] / 765);
      }
      psuW[p] = sumEnd();
    }
    g2.fill(1);
    for (let p = 0; p < P; p++) {
      const a = psuW[p]! / psus[p]!.volts * o.cap;
      if (a > 0) g2[setOf[p]!] = Math.min(g2[setOf[p]!]!, (psus[p]!.rating * o.headroom) / a);
    }
    setW.fill(0);
    for (let p = 0; p < P; p++) setW[setOf[p]!] += psuW[p]! * o.cap * g2[setOf[p]!]!;
    sumStart();
    for (let s = 0; s < S; s++) sumAdd(setW[s]!);
    stats.lastGenW = sumEnd();
    stats.genPeakW = Math.max(stats.genPeakW, stats.lastGenW);
    rule3(o.gen);
    let cut = false;
    for (let s = 0; s < S; s++) {
      const gt = g2[s]! * g3[s]!, g = gt < gPrev[s]! ? gt : Math.min(gt, gPrev[s]! + rel);
      gPrev[s] = g;
      if (g < stats.minGain[sets[s]!]!) stats.minGain[sets[s]!] = g;
      if (!(g < 0.999)) continue;
      cut = true;
      for (let v = 0; v < 256; v++) lut[v] = Math.trunc(v * g);
      for (let p = 0; p < P; p++) {
        if (setOf[p] !== s) continue;
        for (let r = 0, ranges = psus[p]!.ranges; r < ranges.length; r++) {
          for (let i = ranges[r]![0], end = i + ranges[r]![1]; i < end; i++) fr[i] = lut[fr[i]!]!;
        }
      }
    }
    stats.frames++;
    if (cut) stats.compressedFrames++;
    return cut;
  }
  return { apply, stats };
}

/** What an expanded frame draws from the generator at `cap`, in watts (the simulator's check on what was sent). */
export function drawW(table: PowerTable, fr: Uint8Array, cap = COG_POWER.cap) {
  let w = 0;
  for (const p of table.psus) {
    for (const [st, n, watts] of p.ranges) {
      let sum = 0;
      for (let i = st, end = st + n; i < end; i++) sum += fr[i]!;
      w += sum * watts / 765;
    }
  }
  return w * cap;
}
