// The warp contract (SPEC "Modules"): move(), turn() and slide() set every position field of a pixel from one point,
// so any warp works over any source: the place fields from the point in the pixel's frame, the LED fields from the
// layer's LED nearest it (a grid built once per layer, the first time a move asks). Looking that LED up is the dear
// part, so a move only marks the LED fields due; settle() looks it up when something reads them (a source or filter,
// a warp whose code names one, slide()), so a stack of warps pays for one lookup, not one each.
import type { Scene } from './scene.ts';

/** What the contract reads and writes on a pixel (render.ts makePixel). */
type Q = { x: number, y: number, z: number, X: number, Y: number, Z: number, lx: number, ly: number, lz: number,
  a: number, r: number, u: number, i: number, n: number, zone: string, zi: number, fixture: number, strand: number,
  ring: number, row: number, sector: number, petal: number, k: number, seed: number,
  ox: number, oy: number, oz: number, sx: number, sy: number, sz: number, sr: number, cy: number, cz: number,
  due: number };
/** What a layer brings: its pixels (rig indices), their bounds, and the grid once built. */
type Layer = { idx: Int32Array, bounds: { min: number[], max: number[] }, near: Near | null };
type Near = ReturnType<typeof buildNear>;

/** Set by renderFrame: the scene and the running layer. */
export const PLACE: { scene: Scene | null, layer: Layer | null } = { scene: null, layer: null };

const ROUND = 2 * Math.PI, NEAR_CELLS = 64, NEAR_CELL = 0.25;

/** The layer's LEDs in cells, and for every cell the LED nearest its middle (propagated from the lit cells). */
function buildNear(S: Scene, L: Layer) {
  const idx = L.idx, m = idx.length, lo = L.bounds.min, hi = L.bounds.max;
  const cell = Math.max(NEAR_CELL, ...[0, 1, 2].map((a) => (hi[a] - lo[a]) / NEAR_CELLS));
  const n = [0, 1, 2].map((a) => Math.max(1, Math.ceil((hi[a] - lo[a]) / cell + 1e-9)));
  const [nx, ny, nz] = n as [number, number, number], cells = nx * ny * nz;
  const head = new Int32Array(cells).fill(-1), next = new Int32Array(m), near = new Int32Array(cells).fill(-1);
  const cx = (X: number) => Math.min(nx - 1, Math.max(0, Math.floor((X - lo[0]) / cell)));
  const cy = (Y: number) => Math.min(ny - 1, Math.max(0, Math.floor((Y - lo[1]) / cell)));
  const cz = (Z: number) => Math.min(nz - 1, Math.max(0, Math.floor((Z - lo[2]) / cell)));
  const at = (X: number, Y: number, Z: number) => (cx(X) * ny + cy(Y)) * nz + cz(Z);
  const d2 = (k: number, X: number, Y: number, Z: number) => {
    const dx = S.X[k] - X, dy = S.Y[k] - Y, dz = S.Z[k] - Z;
    return dx * dx + dy * dy + dz * dz;
  };
  const mid = (c: number, a: number) => lo[a] + (c + 0.5) * cell;
  for (let j = 0; j < m; j++) {
    const k = idx[j], c = at(S.X[k], S.Y[k], S.Z[k]);
    next[j] = head[c]; head[c] = j;
  }
  const queue: number[] = [];
  for (let c = 0; c < cells; c++) if (head[c] >= 0) { near[c] = idx[head[c]]; queue.push(c); }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q], k = near[c], i = Math.floor(c / (ny * nz)), jy = Math.floor(c / nz) % ny, kz = c % nz;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
      const a = i + di, b = jy + dj, e = kz + dk;
      if (a < 0 || b < 0 || e < 0 || a >= nx || b >= ny || e >= nz) continue;
      const o = (a * ny + b) * nz + e, X = mid(a, 0), Y = mid(b, 1), Z = mid(e, 2);
      if (near[o] < 0 || d2(k, X, Y, Z) < d2(near[o], X, Y, Z) - 1e-12) { near[o] = k; queue.push(o); }
    }
  }
  // Each cell's candidates, once it is first asked: the LEDs in the cells round it and round its nearest.
  const lists: (Int32Array | null)[] = new Array(cells).fill(null), seen = new Int32Array(m).fill(-1);
  function candidates(c: number) {
    const out: number[] = [], k0 = near[c];
    const add = (i: number, jy: number, kz: number) => {
      for (let a = Math.max(0, i - 1); a <= Math.min(nx - 1, i + 1); a++) {
        for (let b = Math.max(0, jy - 1); b <= Math.min(ny - 1, jy + 1); b++) {
          for (let e = Math.max(0, kz - 1); e <= Math.min(nz - 1, kz + 1); e++) {
            for (let j = head[(a * ny + b) * nz + e]; j >= 0; j = next[j]) {
              if (seen[j] !== c) { seen[j] = c; out.push(idx[j]); }
            }
          }
        }
      }
    };
    add(Math.floor(c / (ny * nz)), Math.floor(c / nz) % ny, c % nz);
    if (k0 >= 0) add(cx(S.X[k0]), cy(S.Y[k0]), cz(S.Z[k0]));
    return (lists[c] = Int32Array.from(out));
  }
  /** The rig index of the layer's LED nearest (X, Y, Z) among its cell's candidates (the lowest of equals). */
  function nearest(X: number, Y: number, Z: number) {
    const c = at(X, Y, Z), list = lists[c] || candidates(c);
    let best = -1, bd = Infinity;
    for (let j = 0; j < list.length; j++) {
      const k = list[j], d = d2(k, X, Y, Z);
      if (d < bd || (d === bd && k < best)) { bd = d; best = k; }
    }
    return best;
  }
  return nearest;
}

/** q's LED fields from rig pixel k. */
function led(S: Scene, q: Q, k: number) {
  q.u = S.u[k]; q.i = S.i[k]; q.n = S.n[k];
  const zi = S.zone[k];
  q.zi = zi; q.zone = S.zones[zi]; q.fixture = q.strand = S.fixture[k];
  q.ring = q.row = S.ring[k]; q.sector = q.petal = S.sector[k];
  q.k = k; q.seed = S.seed[k];
}

/** q's place fields from a point in metres: x y z on the rig, lx ly lz and a r in q's frame. */
function reframe(q: Q, X: number, Y: number, Z: number) {
  const S = PLACE.scene;
  q.X = X; q.Y = Y; q.Z = Z;
  if (S) {
    const lo = S.bounds.min, hi = S.bounds.max;
    q.x = (X - lo[0]) / (hi[0] - lo[0] || 1); q.y = (Y - lo[1]) / (hi[1] - lo[1] || 1);
    q.z = (Z - lo[2]) / (hi[2] - lo[2] || 1);
  }
  q.lx = q.sx > 0 ? 0.5 + (X - q.ox) / (2 * q.sx) : 0.5;
  q.ly = q.sy > 0 ? 0.5 + (Y - q.oy) / (2 * q.sy) : 0.5;
  q.lz = q.sz > 0 ? 0.5 + (Z - q.oz) / (2 * q.sz) : 0.5;
  const dz = Z - q.cz, dy = Y - q.cy, a = Math.atan2(dz, dy) / ROUND;
  q.a = a < 0 ? a + 1 : a;
  q.r = q.sr > 0 ? Math.sqrt(dz * dz + dy * dy) / q.sr : 0;
}

/** At (X, Y, Z): its place now, the LED fields of the layer's LED nearest it when settled. */
function goTo(q: Q, X: number, Y: number, Z: number) {
  reframe(q, X, Y, Z);
  q.due = 1;
}

/** q's LED fields, if a move left them due: those of the layer's LED nearest its point. */
export function settle(q: Q) {
  q.due = 0;
  const S = PLACE.scene, L = PLACE.layer;
  if (!S || !L || !L.idx.length) return;
  L.near ||= buildNear(S, L);
  led(S, q, L.near(q.X, q.Y, q.Z));
}

/** Whether module code may read a pixel's LED fields (or attr/is, which read its k): it names one as `.field` or a
 *  string, destructures an object, or reads a computed key. */
export const readsLed = (code: string | undefined) => code === undefined
  || /[.'"`](u|i|n|zone|zi|fixture|strand|ring|row|sector|petal|k|seed|attr|is|part|partUp)\b/.test(code)
  || /\{[^{}]*\}\s*=[^=>]|\(\s*\{|\w\s*\[\s*[A-Za-z_$]/.test(code);

/** move(q, lx, ly, lz): q samples the point (lx, ly, lz) of its frame. */
export function move(q: Q, lx: number, ly: number, lz: number) {
  goTo(q, q.ox + (lx - 0.5) * 2 * q.sx, q.oy + (ly - 0.5) * 2 * q.sy, q.oz + (lz - 0.5) * 2 * q.sz);
}

/** turn(q, a, r): q samples angle a, radius r round its frame's centre (cy, cz), in the façade (its depth stays). */
export function turn(q: Q, a: number, r: number) {
  goTo(q, q.X, q.cy + r * q.sr * Math.cos(ROUND * a), q.cz + r * q.sr * Math.sin(ROUND * a));
  q.a = a - Math.floor(a); q.r = r;
}

/** slide(q, u): q is the LED of its own fixture nearest u along it. */
export function slide(q: Q, u: number) {
  const S = PLACE.scene;
  if (!S) return;
  if (q.due) settle(q);
  const f = S.fixtures[q.fixture], n = f ? f.count : 0;
  if (!n) return;
  const k = f.start + Math.round(Math.min(1, Math.max(0, u)) * (n - 1));
  reframe(q, S.X[k], S.Y[k], S.Z[k]);
  led(S, q, k); q.due = 0;
}
