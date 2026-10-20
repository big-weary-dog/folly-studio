// The pixel p (SPEC "The pixel p"): one per slot of a layer's chain (warps.ts), reused for every LED.
import type { PreparedLayer } from './render.ts';
import { type Scene, tagMask, tagParts } from './scene.ts';

/** The pixel a layer's chain sees, reused for every LED; attr, is, part and partUp read its k. dt and gate: an
 * instance's time offset and how much of it shows (a warp such as in-turn sets them), 0 and 1 otherwise. */
export function makePixel(S: Scene) {
  const q = { x: 0, y: 0, z: 0, X: 0, Y: 0, Z: 0, lx: 0, ly: 0, lz: 0, a: 0, r: 0, u: 0, i: 0, n: 1, zone: '', zi: 0,
    fixture: 0, strand: 0, ring: 0, row: 0, sector: -1, petal: -1, k: 0, seed: 0,
    ox: 0, oy: 0, oz: 0, sx: 0, sy: 0, sz: 0, sr: 0, cy: 0, cz: 0, due: 0, dt: 0, gate: 1,
    attr: (name: string, d = 0): number => { const v = S.attrs.get(name); return v ? v[q.k] : d; },
    is: (tag: string): boolean => tagMask(S, tag)[q.k] === 1,
    part: (tag: string): number => tagParts(S, tag).of[q.k]!, parts: (tag: string): number => tagParts(S, tag).n,
    partUp: (tag: string): number => tagParts(S, tag).up[q.k]! };
  return q;
}
/** The pixel `p` (SPEC "The pixel p"), as every module sees it. */
export type Pixel = ReturnType<typeof makePixel>;

/** q as pixel j of layer L (rig pixel k). */
export function setPixel(S: Scene, L: PreparedLayer, q: Pixel, j: number, k: number) {
  q.x = S.x[k]; q.y = S.y[k]; q.z = S.z[k];
  q.X = S.X[k]; q.Y = S.Y[k]; q.Z = S.Z[k];
  q.lx = L.lx[j]; q.ly = L.ly[j]; q.lz = L.lz[j];
  q.a = L.a[j]; q.r = L.r[j];
  q.u = S.u[k]; q.i = S.i[k]; q.n = S.n[k];
  const zi = S.zone[k];
  q.zi = zi; q.zone = S.zones[zi]; q.fixture = q.strand = S.fixture[k];
  q.ring = q.row = S.ring[k]; q.sector = q.petal = S.sector[k];
  q.k = k; q.seed = S.seed[k];
  const f = L.frame;
  q.ox = f[0]; q.oy = f[1]; q.oz = f[2]; q.sx = f[3]; q.sy = f[4]; q.sz = f[5]; q.sr = f[6];
  q.cy = f[7]; q.cz = f[8]; q.due = 0; q.dt = 0; q.gate = 1;
}

/** The pixel `from` as `to` (their own attr and is read their own k). */
export function copyPixel(to: Pixel, from: Pixel) {
  to.x = from.x; to.y = from.y; to.z = from.z; to.X = from.X; to.Y = from.Y; to.Z = from.Z;
  to.lx = from.lx; to.ly = from.ly; to.lz = from.lz; to.a = from.a; to.r = from.r;
  to.u = from.u; to.i = from.i; to.n = from.n; to.zone = from.zone; to.zi = from.zi;
  to.fixture = from.fixture; to.strand = from.strand; to.ring = from.ring; to.row = from.row;
  to.sector = from.sector; to.petal = from.petal; to.k = from.k; to.seed = from.seed;
  to.ox = from.ox; to.oy = from.oy; to.oz = from.oz; to.sx = from.sx; to.sy = from.sy; to.sz = from.sz; to.sr = from.sr;
  to.cy = from.cy; to.cz = from.cz; to.due = from.due; to.dt = from.dt; to.gate = from.gate;
}
