// The neighbour map (SPEC "The neighbour map"): which LEDs touch which, for modules whose light passes from LED to
// LED (wildfire, waves). Each strand is a chain; strands that come close link where they do; a strand links to the
// next strand of its zone every metre where they run side by side, so the main arches neighbour each other. Pieces
// far apart stay apart. Found once per scene from the rig's positions; links() hands pattern code a layer's share.
import { PLACE } from './place.ts';
import type { Scene } from './scene.ts';
import { MAX_RADIUS, neighbourGraph } from './spatial.ts';

/** Metres: a strand's next LED further than this is a separate piece (floods); other strands this close touch. */
export const CHAIN_GAP = 1, TOUCH = 0.5;
/** Metres: the next strand of a zone within RUNG links to it, a rung every RUNG_EVERY of wire. */
export const RUNG = MAX_RADIUS, RUNG_EVERY = 1;

/** A map as CSR over the rig's pixels: k's neighbours are nb[off[k]] … nb[off[k + 1] − 1], by index. */
export type LinkMap = { off: Int32Array, nb: Int32Array };
/** What links() gives a pattern: the map within the running layer (its pixels, rig indices, in idx), rows by k. */
export type Links = Readonly<LinkMap & { count: number, idx: Int32Array }>;
const MAPS = new WeakMap<Scene, LinkMap>();
const LAYERS = new WeakMap<object, Links>();

/** The rig's neighbour map (built once per scene). */
export function linkMap(S: Scene) {
  let g = MAPS.get(S);
  if (!g) MAPS.set(S, g = buildMap(S));
  return g;
}

function buildMap(S: Scene): LinkMap {
  const N = S.count, F = S.fixture, X = S.X, Y = S.Y, Z = S.Z, space = neighbourGraph(S).space;
  const edges = new Set<number>();
  const link = (a: number, b: number) => { if (a !== b) edges.add(a < b ? a * N + b : b * N + a); };
  const gap = (a: number, b: number) => Math.hypot(X[a] - X[b], Y[a] - Y[b], Z[a] - Z[b]);
  const seen = new Int32Array(S.fixtures.length).fill(-1);
  for (let k = 0; k < N; k++) {
    if (k + 1 < N && F[k + 1] === F[k] && gap(k, k + 1) <= CHAIN_GAP) link(k, k + 1);
    for (let e = space.off[k], end = space.off[k + 1]; e < end && space.d[e] <= TOUCH; e++) {
      const j = space.nb[e], f = F[j];                    // nearest first: the first of each strand is its nearest
      if (f !== F[k] && seen[f] !== k) { seen[f] = k; link(k, j); }
    }
  }
  const next = new Map<string, number>();                  // each fixture's next in its zone, in rig order
  for (let f = S.fixtures.length - 1; f >= 0; f--) {
    const zone = S.fixtures[f].zone ?? S.fixtures[f].id, after = next.get(zone);
    next.set(zone, f);
    if (after === undefined) continue;
    const start = S.fixtures[f].start, n = S.fixtures[f].count;
    let arc = 0, due = RUNG_EVERY / 2;
    for (let k = start; k < start + n; k++) {
      if (k > start) arc += gap(k - 1, k);
      if (arc < due) continue;
      due += RUNG_EVERY;
      for (let e = space.off[k], end = space.off[k + 1]; e < end && space.d[e] <= RUNG; e++) {
        if (F[space.nb[e]] === after) { link(k, space.nb[e]); break; }
      }
    }
  }
  const pairs = Float64Array.from(edges).sort(), deg = new Int32Array(N + 1);
  for (const p of pairs) { const a = Math.floor(p / N); deg[a + 1]++; deg[p - a * N + 1]++; }
  for (let k = 0; k < N; k++) deg[k + 1] += deg[k];
  const off = deg.slice(), fill = deg.slice(0, N), nb = new Int32Array(2 * pairs.length);
  for (const p of pairs) { const a = Math.floor(p / N), b = p - a * N; nb[fill[a]++] = b; nb[fill[b]++] = a; }
  for (let k = 0; k < N; k++) nb.subarray(off[k], off[k + 1]).sort();
  return { off, nb };
}

/** The map within a layer's pixels (rows of pixels outside it empty). */
export function layerLinks(S: Scene, idx: Int32Array): Links {
  const N = S.count, g = linkMap(S), inside = new Uint8Array(N), off = new Int32Array(N + 1), nb: number[] = [];
  for (const k of idx) inside[k] = 1;
  for (let k = 0; k < N; k++) {
    if (inside[k]) for (let e = g.off[k]; e < g.off[k + 1]; e++) if (inside[g.nb[e]]) nb.push(g.nb[e]);
    off[k + 1] = nb.length;
  }
  return Object.freeze({ count: N, idx, off, nb: Int32Array.from(nb) });
}

const NO_LINKS: Links = Object.freeze({ count: 0, idx: new Int32Array(0), off: new Int32Array(1),
  nb: new Int32Array(0) });
/** links(): the running layer's neighbour map (SPEC "The neighbour map"), the same object every frame; read only. */
export function links(): Links {
  const S = PLACE.scene, L = PLACE.layer;
  if (!S || !L) return NO_LINKS;
  let m = LAYERS.get(L);
  if (!m) LAYERS.set(L, m = layerLinks(S, L.idx));
  return m;
}
