// Spatial modules (SPEC "Spatial modules"): the rig's neighbours, found once per scene, and the native blur a chain
// runs between its stages, over one layer's pixels. Nothing here allocates per frame.
import { toLight, toValue } from './light.ts';
import type { Scene } from './scene.ts';

/** Metres: how far the neighbour lists reach, so the most a blur's radius can be. */
export const MAX_RADIUS = 1.5;
const MAX_HOPS = 64;                       // along the wire, at most this many pixels each way
const MAX_CELLS = 64;                      // the space grid's cells along its longest side, at most
export const BLUR_MODES = Object.freeze(['wire', 'space', 'both'] as const);
export type BlurMode = (typeof BLUR_MODES)[number];
/** What new layers soften by: bars and chases lose their stair-steps along the wire, nothing goes mushy. */
export const DEFAULT_SOFTEN: Readonly<{ radius: number, mode: BlurMode }> = Object.freeze({ radius: 0.15,
  mode: 'wire' });

/** Neighbours as CSR: pixel k's are nb[off[k]] … nb[off[k + 1] − 1], at distances d (metres), nearest first. */
export type Neighbours = { off: Int32Array, nb: Int32Array, d: Float32Array };
const GRAPHS = new WeakMap<Scene, { space: Neighbours, wire: Neighbours }>();

/** Each pixel's neighbours within MAX_RADIUS, in space and along its fixture's wire (built once per scene). */
export function neighbourGraph(S: Scene) {
  let g = GRAPHS.get(S);
  if (!g) {
    g = Object.freeze({ space: spaceGraph(S), wire: wireGraph(S) });
    GRAPHS.set(S, g);
  }
  return g;
}

type Push = (j: number, d: number) => void;
// A neighbour as one sortable number: its distance in steps of 2^-20 m, then its index (< 2^23); exact in a double.
const STEP = 2 ** 20, SLOT = 2 ** 23;
/** CSR from `each(k, push)`, each row sorted nearest first, ties by index (so every engine sums in one order). */
function csr(N: number, each: (k: number, push: Push) => void): Neighbours {
  if (N >= SLOT) throw new Error(`neighbourGraph: at most ${SLOT} pixels`);
  const off = new Int32Array(N + 1);
  let keys = new Float64Array(16 * N + 16), n = 0;
  const push: Push = (j, dist) => {
    if (n === keys.length) { const more = new Float64Array(2 * n); more.set(keys); keys = more; }
    keys[n++] = Math.round(dist * STEP) * SLOT + j;
  };
  for (let k = 0; k < N; k++) {
    each(k, push);
    keys.subarray(off[k], n).sort();
    off[k + 1] = n;
  }
  const nb = new Int32Array(n), d = new Float32Array(n);
  for (let e = 0; e < n; e++) { const q = Math.floor(keys[e] / SLOT); nb[e] = keys[e] - q * SLOT; d[e] = q / STEP; }
  return { off, nb, d };
}

/** Pixels within MAX_RADIUS of each other: a uniform grid of cells at least that wide, each pixel against the 27
 * cells round its own. */
function spaceGraph(S: Scene) {
  const N = S.count, P = [S.X, S.Y, S.Z], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < N; k++) {
    for (let a = 0; a < 3; a++) { const v = P[a][k]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
  }
  const cell = Math.max(MAX_RADIUS, ...[0, 1, 2].map((a) => (hi[a] - lo[a]) / MAX_CELLS));
  const [nx, ny, nz] = [0, 1, 2].map((a) => (N ? Math.floor((hi[a] - lo[a]) / cell) + 1 : 1));
  const at = [0, 1, 2].map((a) => Int32Array.from(P[a], (v) => Math.floor((v - lo[a]) / cell)));
  const [ax, ay, az] = at, cellOf = new Int32Array(N), start = new Int32Array(nx * ny * nz + 1);
  for (let k = 0; k < N; k++) start[(cellOf[k] = (ax[k] * ny + ay[k]) * nz + az[k]) + 1]++;
  for (let c = 1; c < start.length; c++) start[c] += start[c - 1];
  const fill = start.slice(0, -1), items = new Int32Array(N);
  for (let k = 0; k < N; k++) items[fill[cellOf[k]]++] = k;
  const R2 = MAX_RADIUS * MAX_RADIUS, X = S.X, Y = S.Y, Z = S.Z;
  return csr(N, (k, push) => {
    const x0 = Math.max(0, ax[k] - 1), x1 = Math.min(nx - 1, ax[k] + 1), y0 = Math.max(0, ay[k] - 1);
    const y1 = Math.min(ny - 1, ay[k] + 1), z0 = Math.max(0, az[k] - 1), z1 = Math.min(nz - 1, az[k] + 1);
    const Xk = X[k], Yk = Y[k], Zk = Z[k];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const row = (x * ny + y) * nz;
        for (let i = start[row + z0], end = start[row + z1 + 1]; i < end; i++) {   // cells z0..z1 are contiguous
          const j = items[i], dx = X[j] - Xk, dy = Y[j] - Yk, dz = Z[j] - Zk, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 <= R2 && j !== k) push(j, Math.sqrt(d2));
        }
      }
    }
  });
}

/** Pixels of the same fixture within MAX_RADIUS of wire (the sum of the steps between them), MAX_HOPS each way. */
function wireGraph(S: Scene) {
  const N = S.count, F = S.fixture, arc = new Float64Array(N);
  for (let k = 1; k < N; k++) {
    if (F[k] !== F[k - 1]) continue;
    arc[k] = arc[k - 1] + Math.hypot(S.X[k] - S.X[k - 1], S.Y[k] - S.Y[k - 1], S.Z[k] - S.Z[k - 1]);
  }
  return csr(N, (k, push) => {
    for (let j = k - 1; j >= 0 && k - j <= MAX_HOPS && F[j] === F[k] && arc[k] - arc[j] <= MAX_RADIUS; j--) {
      push(j, arc[k] - arc[j]);
    }
    for (let j = k + 1; j < N && j - k <= MAX_HOPS && F[j] === F[k] && arc[j] - arc[k] <= MAX_RADIUS; j++) {
      push(j, arc[j] - arc[k]);
    }
  });
}

/** A layer's blur state: each pixel's index in the layer (−1 outside it), and scratch buffers of its rgba: the
 * colours' light, the blurred. */
export function blurState(S: Scene, idx: Int32Array) {
  const loc = new Int32Array(S.count).fill(-1);
  for (let j = 0; j < idx.length; j++) loc[idx[j]] = j;
  neighbourGraph(S);                       // built now, at prepare time, not in the first frame
  return { loc, lit: new Float64Array(idx.length * 4), tmp: new Float64Array(idx.length * 4) };
}
type BlurState = ReturnType<typeof blurState>;

// The gaussian exp(−2 (d / radius)²) as a table over x = (d / radius)² · LUT, linear between entries (error < 1e-5).
const LUT = 256;
const EXP = new Float64Array(LUT + 2);
for (let i = 0; i < EXP.length; i++) EXP[i] = Math.exp(-2 * i / LUT);
const SUM = new Float64Array(5);          // weight, then the weighted alpha, red, green and blue

/** Adds k's neighbours in graph g within r, those in the layer (loc ≥ 0), into SUM. */
function gather(g: Neighbours, k: number, r: number, inv: number, loc: Int32Array, buf: Float64Array) {
  const nb = g.nb, d = g.d;
  let W = 0, A = 0, R = 0, Gr = 0, B = 0;
  for (let e = g.off[k], end = g.off[k + 1]; e < end; e++) {
    const dist = d[e];
    if (dist > r) break;
    const j = loc[nb[e]];
    if (j < 0) continue;
    const x = dist * dist * inv, i = x | 0, w = EXP[i] + (EXP[i + 1] - EXP[i]) * (x - i);
    const o = 4 * j, wa = w * buf[o + 3];
    W += w; A += wa; R += wa * buf[o]; Gr += wa * buf[o + 1]; B += wa * buf[o + 2];
  }
  SUM[0] += W; SUM[1] += A; SUM[2] += R; SUM[3] += Gr; SUM[4] += B;
}

/**
 * Blurs a layer's colours (buf: rgba per pixel of idx, straight alpha) in place: each the weighted mean of itself and
 * its in-layer neighbours within `radius` m (`mode`: wire, space or both summed), premultiplied by alpha, the mean of
 * their light (toLight, toValue), then mixed with the unblurred colour by `amount`. Radius or amount 0: untouched.
 */
export function blur(S: Scene, idx: Int32Array, st: BlurState, buf: Float64Array, radius: unknown, mode: unknown,
  amount: unknown) {
  const r0 = Number(radius), a0 = amount === undefined ? 1 : Number(amount);
  const r = r0 > MAX_RADIUS ? MAX_RADIUS : r0, mix = a0 > 1 ? 1 : a0;
  if (!(r > 0) || !(mix > 0)) return;
  const g = neighbourGraph(S), wire = mode !== 'space', space = mode !== 'wire', self = wire && space ? 2 : 1;
  const inv = LUT / (r * r), loc = st.loc, lit = st.lit, tmp = st.tmp, m = idx.length;
  for (let i = 0; i < 4 * m; i++) lit[i] = (i & 3) === 3 ? buf[i] : toLight(buf[i]);
  for (let j = 0; j < m; j++) {
    const k = idx[j], o = 4 * j, a = lit[o + 3] * self;
    SUM[0] = self; SUM[1] = a; SUM[2] = a * lit[o]; SUM[3] = a * lit[o + 1]; SUM[4] = a * lit[o + 2];
    if (wire) gather(g.wire, k, r, inv, loc, lit);
    if (space) gather(g.space, k, r, inv, loc, lit);
    const A = SUM[1];
    tmp[o + 3] = A / SUM[0];
    for (let c = 0; c < 3; c++) tmp[o + c] = A > 0 ? toValue(SUM[2 + c] / A) : 0;
  }
  if (mix === 1) buf.set(tmp);
  else for (let i = 0; i < 4 * m; i++) buf[i] += (tmp[i] - buf[i]) * mix;
}
