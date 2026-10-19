// The Playa view's geometry, built once per rig from its render hints alone (SPEC "Rig"), in the view frame
// (T maps rig axes onto it). strip: a camera-facing ribbon per pixel, midpoint to midpoint (bulbs: globes on a
// wire); points: sprites; cells: each pixel's polygon; flood: a cone per pixel, a beam or a lit shell; and the
// playa, a disc of rings closer together near the middle. Pure.
import type { Fixture } from '../../../shared/schemas/rig.ts';
import type { frameOf } from '../viewer.ts';

type V = number[];
type ToView = ReturnType<typeof frameOf>;
const sub = (a: V, b: V) => a.map((x, k) => x - b[k]);
const len = (a: V) => Math.hypot(...a);
const norm = (a: V, l = len(a) || 1) => a.map((x) => x / l);
const cross = (a: V, b: V) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const PER = { strip: 64, point: 5, cell: 8, beam: 8, shell: 8, line: 3 };
type Kind = keyof typeof PER;
/** A fixture's render hints (SPEC "Rig"). */
type Hints = { radius?: number; bulbs?: boolean; sag?: number; cells?: number[][]; cone?: { angle?: number;
  length?: number; dir?: V; dirs?: V[]; apex?: V[]; solid?: boolean } };
type Build = Record<Kind, number[]> & { weight: Float32Array; spill: Float32Array; ground: number };
export type Geometry = Record<Kind, Float32Array> & { [K in Kind as `n${K}`]: number }
  & { weight: Float32Array; spill: Float32Array; ground: number };

/**
 * Float32Arrays and counts for the GPU; for the light on the playa, each pixel's share (weight) and where it
 * seems to come from (spill): halfway down to the ground, or for a beam aimed down, near where it lands.
 */
export function buildGeometry(rig: { fixtures: Pick<Fixture, 'kind' | 'start' | 'count' | 'render'>[];
  structure?: { lines?: unknown } }, pos: Float32Array, count: number, T: ToView, ground = 0): Geometry {
  const o: Build = { weight: new Float32Array(count), ground, strip: [], point: [], cell: [], beam: [], shell: [],
    line: [], spill: Float32Array.from(pos, (x, i) => (i % 3 === 1 ? (ground + x) / 2 : x)) };
  const P = (k: number) => [pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]];
  for (const f of rig.fixtures) {
    const s = f.start | 0, n = Math.min(f.count | 0, count - s), k = f.kind;
    const build = k === 'strip' ? strip : k === 'cells' ? cells : k === 'flood' ? flood : points;
    if (n > 0 && s >= 0) build(o, (f.render || {}) as Hints, s, n, P, T);
  }
  for (const l of (rig.structure?.lines || []) as V[]) if (l.length === 6) o.line.push(...T(l), ...T(l, 3));
  const g = { weight: o.weight, spill: o.spill, ground } as Geometry;
  for (const k of Object.keys(PER) as Kind[]) {
    g[k] = Float32Array.from(o[k], (x) => (Number.isFinite(x) ? x : 0));
    g[`n${k}`] = g[k].length / PER[k];
  }
  return g;
}

function strip(o: Build, r: Hints, s: number, n: number, P: (k: number) => V) {
  const rad = r.radius || 0.03, pts: V[] = [];
  for (let i = 0, u; i < n; i++) {
    pts.push(P(s + i));
    u = i / (n - 1 || 1);
    pts[i][1] -= (r.sag || 0) * 4 * u * (1 - u);
  }
  const gaps = pts.slice(1).map((p, i) => len(sub(p, pts[i]))).sort((a, b) => a - b);
  // Neighbours, unless over 4 median gaps apart (a new run).
  const near = (i: number, j: number) => pts[j] && len(sub(pts[i], pts[j])) < 4 * (gaps[gaps.length >> 1] || 1);
  for (let i = 0; i < n; i++) {
    const p = pts[i], prev = near(i, i - 1), next = near(i, i + 1);
    o.weight[s + i] = r.bulbs ? 0.3 : 0.4 + 4 * rad;
    if (r.bulbs) {
      o.point.push(...p, s + i, rad);
      if (next) o.line.push(...p, ...pts[i + 1]);
      continue;
    }
    // Ends at the midpoints, where the chord is the tangent, so neighbouring ribbons share their edges.
    const back = prev ? sub(p, pts[i - 1]) : next ? sub(pts[i + 1], p) : [0, 2 * rad, 0];
    const fwd = next ? sub(pts[i + 1], p) : back;
    const quad = [...sub(p, back.map((x) => x / 2)), s + i, ...p.map((x, k) => x + fwd[k] / 2), rad,
      ...norm(back), +prev + 2 * +next, ...norm(fwd), 0];
    for (let c = 0; c < 4; c++) o.strip.push(...quad);   // a quad's corners: gl_VertexID & 3
  }
}

function points(o: Build, r: Hints, s: number, n: number, P: (k: number) => V) {
  for (let i = s; i < s + n; i++) {
    o.point.push(...P(i), i, r.radius || 0.03);
    o.weight[i] = 0.3;
  }
}

// Each vertex: xyz, pixel, the cell's middle and radius. The rim is drawn 1.2 cm in: the dark leading.
function cells(o: Build, r: Hints, s: number, n: number, P: unknown, T: ToView) {
  (r.cells || []).slice(0, n).forEach((flat, i) => {
    const v: V[] = [];
    for (let j = 0; j + 2 < flat.length; j += 3) v.push(T(flat, j));
    const c = [0, 1, 2].map((k) => v.reduce((t, p) => t + p[k], 0) / v.length);
    const R = Math.max(...v.map((p) => len(sub(p, c))));
    const lead = v.map((p) => p.map((x, k) => x + (c[k] - x) * Math.min(0.3, 0.012 / (len(sub(c, p)) || 1))));
    for (const j of earClip(v)) o.cell.push(...lead[j], s + i, ...c, R);
    o.weight[s + i] = 3;
  });
}

// 12 quads round the axis; each vertex: xyz, pixel, normal, t (0 at the apex, 1 at the end). A beam is drawn
// 6 m long at most: its glow has faded by then.
function flood(o: Build, r: Hints, s: number, n: number, P: (k: number) => V, T: ToView) {
  const c = r.cone || {}, solid = !!c.solid, half = (Math.min(170, c.angle || 40) * Math.PI) / 360;
  const L = Math.min(c.length || 3, solid ? 1e3 : 6), tan = Math.tan(half) * L;
  for (let i = 0; i < n; i++) {
    const d = norm(T(c.dirs?.[i] || c.dir || [0, -1, 0])), p = c.apex?.[i] ? T(c.apex[i]) : P(s + i);
    const u = norm(cross(d, Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), w = cross(d, u);
    const ring = (t: number, a: number) => {
      const out = u.map((x, k) => x * Math.cos(a) + w[k] * Math.sin(a));
      return [...p.map((x, k) => x + (d[k] * L + out[k] * tan) * t), s + i,
        ...norm(out.map((x, k) => x * Math.cos(half) - d[k] * Math.sin(half))), t];
    };
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6, b = a + Math.PI / 6, t0 = solid ? 0 : 0.02;
      const q = [ring(t0, a), ring(1, a), ring(1, b), ring(t0, b)];
      for (const j of [0, 1, 2, 0, 2, 3]) o[solid ? 'shell' : 'beam'].push(...q[j]);
    }
    if (!solid) o.point.push(...p, s + i, 0.05);     // the lens
    o.weight[s + i] = solid ? 0.6 : 30 * (0.2 + 0.8 * Math.max(0, -d[1]));
    const fall = d[1] < -0.2 ? Math.min(c.length || 3, (p[1] - o.ground) / -d[1]) * 0.7 : 0;
    o.spill.set(p.map((x, k) => x + d[k] * fall), 3 * (s + i));
  }
}

/** Triangles (vertex indices) of a planar simple polygon, ear-clipped in its own plane. */
export function earClip(v: V[]) {
  const N = [0, 1, 2].map((k) => v.reduce((t, a, i) => {
    const b = v[(i + 1) % v.length], y = (k + 1) % 3, z = (k + 2) % 3;
    return t + (a[y] - b[y]) * (a[z] + b[z]);
  }, 0));
  const ax = N.indexOf(N.reduce((m, x) => (Math.abs(x) > Math.abs(m) ? x : m), 0));
  const U = (ax + 1) % 3, V = (ax + 2) % 3, sign = Math.sign(N[ax]) || 1;
  const cr = (a: number, b: number, c: number) => sign * ((v[b][U] - v[a][U]) * (v[c][V] - v[a][V])
    - (v[b][V] - v[a][V]) * (v[c][U] - v[a][U]));
  const idx = v.map((_, i) => i), tris: number[] = [];
  for (let guard = v.length ** 2; idx.length > 3 && guard--;) {
    for (let i = 0, m = idx.length; i < m; i++) {
      const a = idx[(i + m - 1) % m], b = idx[i], c = idx[(i + 1) % m], k = cr(a, b, c);
      if (k < 0 || (k > 0 && idx.some((p) => p !== a && p !== b && p !== c && cr(a, b, p) >= 0 && cr(b, c, p) >= 0
        && cr(c, a, p) >= 0))) continue;
      if (k > 0) tris.push(a, b, c);
      idx.splice(i, 1);
      break;
    }
  }
  return idx.length === 3 ? tris.concat(idx) : tris;
}

/** Up to k spill lights: pixels on a grid just coarse enough; { of, n, centre: [x, y, z, softness²] × k }. */
export function cluster(pos: Float32Array, count: number, k: number) {
  for (let cell = 1.5; ; cell *= 1.25) {
    const keys = new Map(), of = new Int16Array(count), centre = new Float32Array(4 * k), n = new Float32Array(k);
    for (let p = 0; p < count; p++) {
      const key = [0, 1, 2].map((a) => Math.floor(pos[3 * p + a] / cell)).join();
      if (!keys.has(key)) keys.set(key, keys.size);
      of[p] = keys.get(key)!;
      if (keys.size > k) break;
      n[of[p]]++;
      for (let a = 0; a < 3; a++) centre[4 * of[p] + a] += pos[3 * p + a];
    }
    if (keys.size > k) continue;
    for (let c = 0; c < 4 * keys.size; c++) {
      centre[c] = c % 4 < 3 ? centre[c] / n[c >> 2] : Math.max(2, 0.15 * cell * cell);   // softness²: a wide pool
    }
    return { of, n: keys.size, centre };
  }
}

/** The playa round (x, z): rings 1.5 m × 1.2^j out to 600 m, 64 segments; { pos: [x, z, …], index }. */
export function playa(x: number, z: number) {
  const pos = [x, z], index: number[] = [], S = 64;
  for (let j = 0, r = 1.5; r < 700; j++, r *= 1.2) {
    for (let k = 0; k < S; k++) {
      const a = (k / S) * 2 * Math.PI, at = 1 + j * S;
      pos.push(x + r * Math.cos(a), z + r * Math.sin(a));
      const k1 = (k + 1) % S;
      if (j) index.push(at - S + k, at + k, at + k1, at - S + k, at + k1, at - S + k1);
      else index.push(0, at + k, at + k1);
    }
  }
  return { pos: new Float32Array(pos), index: new Uint32Array(index) };
}
