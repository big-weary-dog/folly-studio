// The neighbour map (SPEC "The neighbour map"): which LEDs touch which, for modules whose light passes from LED to
// LED (wildfire, waves). Each strand is a chain; strands that come close link where they do; a strand links to the
// next strand of its zone every metre where they run side by side, so the main arches neighbour each other. Pieces
// far apart stay apart. Found once per scene from the rig's positions; links() hands pattern code a layer's share.
import { PLACE } from './place.ts';
import { groupsByTag, pixelsForGroups, type Scene, tagCentres, tagParts } from './scene.ts';
import { rand } from './stdlib.ts';
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
const LAYERS = new WeakMap<object, Map<string, Links>>();

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

/** The map between `tag`'s parts within a layer: a part (by its index) per row, linked where their LEDs link. */
export function partLinks(S: Scene, idx: Int32Array, tag: string): Links {
  const g = layerLinks(S, idx), { of, n } = tagParts(S, tag), pairs = new Set<number>(), has = new Uint8Array(n);
  for (const k of idx) {
    const a = of[k];
    if (a < 0) continue;
    has[a] = 1;
    for (let e = g.off[k]; e < g.off[k + 1]; e++) {
      const b = of[g.nb[e]];
      if (b >= 0 && b !== a) pairs.add(a * n + b);
    }
  }
  const off = new Int32Array(n + 1), nb = [...pairs].sort((x, y) => x - y);
  for (const p of nb) off[Math.floor(p / n) + 1]++;
  for (let a = 0; a < n; a++) off[a + 1] += off[a];
  return Object.freeze({ count: n, idx: Int32Array.from(has.keys()).filter((a) => has[a]),
    off, nb: Int32Array.from(nb, (p) => p % n) });
}

const NO_LINKS: Links = Object.freeze({ count: 0, idx: new Int32Array(0), off: new Int32Array(1),
  nb: new Int32Array(0) });
/**
 * links(tag?): the running layer's neighbour map (SPEC "The neighbour map"), the same object every frame; read only.
 * With a tag, the map between its parts (rows by p.part(tag)).
 */
export function links(tag?: string): Links {
  const S = PLACE.scene, L = PLACE.layer, key = tag === undefined ? '' : String(tag);
  if (!S || !L) return NO_LINKS;
  let byTag = LAYERS.get(L), m = byTag?.get(key);
  if (!byTag) LAYERS.set(L, byTag = new Map());
  if (!m) byTag.set(key, m = key ? partLinks(S, L.idx, key) : layerLinks(S, L.idx));
  return m;
}

/** Metres: a piece the wiring never reaches from `from` starts this much after its straight-line distance; the band
 * of LEDs a start takes in: each network's highest (or lowest) for `top` (`bottom`), each group's nearest its
 * centre. */
export const WIRE_LAG = 2, WIRE_BAND = 0.1;
type PerLayer = WeakMap<object, Map<string, Float64Array>>;
const DISTANCES: PerLayer = new WeakMap(), ROWS: PerLayer = new WeakMap();
/** A layer's array under `key`, made the first time it is asked. */
function perLayer(cache: PerLayer, key: string, make: (S: Scene, L: Links) => Float64Array) {
  const S = PLACE.scene, L = PLACE.layer;
  if (!S || !L) return new Float64Array(0);
  let byKey = cache.get(L), d = byKey?.get(key);
  if (!byKey) cache.set(L, byKey = new Map());
  if (!d) byKey.set(key, d = make(S, links()));
  return d;
}

/**
 * wireDistance(from): metres along the running layer's wiring (links()) from `from`, by k, the same array every frame
 * of a layer; read only. `from` is a tag (each of its groups' LEDs in the layer nearest the group's centre: the rose's
 * heart), or `top` / `bottom` (each network's highest or lowest LEDs). A piece the wiring never reaches starts at its
 * straight-line distance from the nearest start plus WIRE_LAG; Infinity outside the layer, and everywhere when nothing
 * starts.
 */
export function wireDistance(from: string) {
  return perLayer(DISTANCES, String(from), (S, L) => wiresFrom(S, L, String(from)));
}

function wiresFrom(S: Scene, L: Links, from: string) {
  const { idx, off, nb } = L, d = new Float64Array(S.count).fill(Infinity), X = S.X, Y = S.Y, Z = S.Z;
  const gap = (a: number, b: number) => Math.hypot(X[a] - X[b], Y[a] - Y[b], Z[a] - Z[b]);
  const starts: number[] = [];
  if (from === 'top' || from === 'bottom') {               // each network's band of highest (or lowest) LEDs
    const net = new Int32Array(S.count).fill(-1), sign = from === 'top' ? -1 : 1;
    for (const k of idx) {
      if (net[k] >= 0) continue;
      const piece = [k];
      net[k] = k;
      for (let i = 0; i < piece.length; i++) {
        for (let e = off[piece[i]]; e < off[piece[i] + 1]; e++) {
          if (net[nb[e]] < 0) { net[nb[e]] = k; piece.push(nb[e]); }
        }
      }
      let end = Infinity;
      for (const j of piece) end = Math.min(end, sign * Y[j]);
      for (const j of piece) if (sign * Y[j] <= end + WIRE_BAND) starts.push(j);
    }
  } else {
    const inside = new Uint8Array(S.count), mid = tagCentres(S, from);
    for (const k of idx) inside[k] = 1;
    groupsByTag(S, from).forEach((g, i) => {               // each group's heart: its LEDs nearest its centre
      const [cx, cy, cz] = mid[i], own = pixelsForGroups(S, g.id).filter((k) => inside[k]);
      const r = Array.from(own, (k) => Math.hypot(X[k] - cx, Y[k] - cy, Z[k] - cz)), near = Math.min(...r);
      own.forEach((k, j) => { if (r[j] <= near + WIRE_BAND) starts.push(k); });
    });
  }
  if (!starts.length) return d;
  for (const k of starts) d[k] = 0;
  spread(d, starts, off, nb, gap);
  const missed = idx.filter((k) => d[k] === Infinity);   // pieces the wiring never reaches: straight-line, plus a lag
  for (const k of missed) {
    let best = Infinity;
    for (const s of starts) best = Math.min(best, gap(k, s));
    d[k] = best + WIRE_LAG;
  }
  spread(d, Array.from(missed), off, nb, gap);
  return d;
}

/** Dijkstra from `from` (each at its d[]) over CSR rows, `gap` the length of a link: d[] settled in place. */
type Gap = (a: number, b: number) => number;
function spread(d: Float64Array, from: number[], off: Int32Array, nb: Int32Array, gap: Gap) {
  const h: number[] = [], done = new Uint8Array(d.length);
  const push = (k: number) => {
    let i = h.push(k) - 1;
    for (let up = (i - 1) >> 1; i > 0 && d[h[up]] > d[k]; i = up, up = (i - 1) >> 1) h[i] = h[up];
    h[i] = k;
  };
  const pop = () => {
    const top = h[0], last = h.pop()!;
    if (!h.length) return top;
    let i = 0;
    for (let c = 1; c < h.length; i = c, c = 2 * i + 1) {
      if (c + 1 < h.length && d[h[c + 1]] < d[h[c]]) c++;
      if (d[h[c]] >= d[last]) break;
      h[i] = h[c];
    }
    h[i] = last;
    return top;
  };
  for (const k of from) push(k);
  while (h.length) {
    const k = pop();
    if (done[k]) continue;
    done[k] = 1;
    for (let e = off[k]; e < off[k + 1]; e++) {
      const j = nb[e], w = d[k] + gap(k, j);
      if (w < d[j]) { d[j] = w; push(j); }
    }
  }
}

/**
 * rowOrder(by, seed): the running layer as one row, by k: 0 at its first LED to 1 at its last; NaN outside it.
 * `strands` strand after strand (rig order, each from its start), `groups` group after group (the smallest groups
 * under `all`, rig order within each), `random` a fixed shuffle that `seed` deals. The same array every frame of a
 * layer; read only.
 */
export function rowOrder(by: string, seed = 0) {
  const s = Math.round(seed) || 0, key = by === 'random' ? `random:${s}` : by === 'groups' ? 'groups' : 'strands';
  return perLayer(ROWS, key, (S, L) => {
    const order = Array.from(L.idx), part = key === 'groups' ? tagParts(S, 'all').of : null;
    if (key !== 'strands') {
      const k2 = new Float64Array(S.count);
      for (const k of order) k2[k] = part ? (part[k] < 0 ? Infinity : part[k]) : rand(k, s);
      order.sort((a, b) => k2[a] - k2[b] || a - b);
    }
    const out = new Float64Array(S.count).fill(NaN), m = Math.max(1, order.length - 1);
    order.forEach((k, i) => { out[k] = i / m; });
    return out;
  });
}

/**
 * waveStep(L, h, v, speed, settle, bounce): one step of the wave equation on a links() map, for Waves and Splash.
 * h and v (by k) are each LED's height and how fast it moves; each is pulled toward its neighbours' mean, so a ripple
 * travels `speed` links a step (substepped above half a link) and loses `settle` of its motion a step. A strand's end
 * (one link) sends back `bounce` of a ripple and lets the rest run out (a one-way edge).
 */
export function waveStep(L: Links, h: Float32Array, v: Float32Array, speed: number, settle: number, bounce: number) {
  const { idx, off, nb } = L, m = idx.length, n = Math.max(1, Math.ceil(speed / 0.5)), c = speed / n;
  const c2 = 2 * c * c, keep = 1 - Math.min(1, Math.max(0, settle)) / n, out = (c - 1) / (c + 1);
  const b = 1 - (1 - Math.min(1, Math.max(0, bounce))) ** 3;       // so what comes back runs about as bounce
  for (let s = 0; s < n; s++) {
    for (let i = 0; i < m; i++) {
      const k = idx[i], e0 = off[k], e1 = off[k + 1];
      if (e0 === e1) continue;
      let sum = 0;
      for (let e = e0; e < e1; e++) sum += h[nb[e]];
      v[k] = (v[k] + c2 * (sum / (e1 - e0) - h[k])) * keep;
    }
    for (let i = 0; i < m; i++) {                          // the ends (one link): part bounce, part a one-way edge
      const k = idx[i], j = nb[off[k]];
      if (off[k + 1] - off[k] !== 1) continue;
      const free = h[j] + out * (h[j] + v[j] - h[k]) - h[k];   // the edge a ripple runs out of
      v[k] = b * v[k] + (1 - b) * free;
    }
    for (let i = 0; i < m; i++) h[idx[i]] += v[idx[i]];
  }
}
