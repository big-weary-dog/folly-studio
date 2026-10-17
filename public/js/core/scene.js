// The scene (cathedral.json as typed arrays), group membership, and the timeline's clips.
import { clamp, hash, isNum } from './stdlib.js';

/** cathedral.json -> a scene of typed arrays (CSV order), shared by every layer. */
export function prepareScene(cathedral) {
  if (!cathedral || !cathedral.pixels) throw new Error('prepareScene: not a cathedral.json');
  const N = cathedral.count | 0;
  const px = cathedral.pixels;
  for (const k of ['zone', 'strand', 'universe', 'channel', 'row']) {
    if (!px[k] || px[k].length !== N) throw new Error(`prepareScene: pixels.${k} must have ${N} entries`);
  }
  if (!px.pos || px.pos.length !== N * 3) throw new Error(`prepareScene: pixels.pos must have ${N * 3} entries`);
  const lo = cathedral.bounds.min, hi = cathedral.bounds.max;
  const span = [0, 1, 2].map((i) => (hi[i] - lo[i]) || 1);
  const cpu = cathedral.channelsPerUniverse || 510;
  const zones = cathedral.zones.slice();
  const zoneIndex = new Map(zones.map((z, i) => [z, i]));
  const petalOfZone = zones.map((z) => { const m = /^rose-petal-(\d+)$/.exec(z); return m ? +m[1] - 1 : -1; });
  const strands = cathedral.strands || [];
  const F = () => new Float64Array(N), I = () => new Int32Array(N);
  const s = {
    count: N, channelsPerUniverse: cpu, universes: cathedral.universes, frameChannels: cathedral.universes * cpu,
    bounds: { min: lo.slice(), max: hi.slice() }, zones, zoneIndex, strands, groups: cathedral.groups || [],
    groupById: new Map((cathedral.groups || []).map((g) => [g.id, g])), groupCache: new Map(),
    X: F(), Y: F(), Z: F(), x: F(), y: F(), z: F(),
    zone: Int32Array.from(px.zone), strand: Int32Array.from(px.strand), row: Int32Array.from(px.row),
    petal: I(), u: F(), i: I(), n: I(), seed: F(), addr: I(),
  };
  for (let k = 0; k < N; k++) {
    const X = px.pos[3 * k], Y = px.pos[3 * k + 1], Z = px.pos[3 * k + 2];
    s.X[k] = X; s.Y[k] = Y; s.Z[k] = Z;
    s.x[k] = (X - lo[0]) / span[0]; s.y[k] = (Y - lo[1]) / span[1]; s.z[k] = (Z - lo[2]) / span[2];
    s.petal[k] = petalOfZone[s.zone[k]] ?? -1;
    s.seed[k] = hash(k * 7919 + 13);
    s.addr[k] = (px.universe[k] - 1) * cpu + (px.channel[k] - 1);
    s.n[k] = 1;
  }
  for (const st of strands) {
    const n = st.count | 0;
    for (let j = 0; j < n; j++) {
      const k = st.start + j;
      s.i[k] = j; s.n[k] = n; s.u[k] = n > 1 ? j / (n - 1) : 0;
    }
  }
  return s;
}

function groupMembers(scene, g, seen = new Set()) {
  let cached = scene.groupCache.get(g.id);
  if (cached) return cached;
  if (seen.has(g.id)) return new Int32Array(0);
  seen.add(g.id);
  const N = scene.count;
  const mask = new Uint8Array(N);
  const zoneSet = new Set((g.zones || []).map((z) => (typeof z === 'number' ? z : scene.zoneIndex.get(z))));
  const strandSet = new Set(g.strands || []);
  const rows = g.rows && g.rows.length ? new Set(g.rows) : null;
  if (zoneSet.size || strandSet.size) {
    for (let k = 0; k < N; k++) {
      const hit = zoneSet.has(scene.zone[k]) || strandSet.has(scene.strand[k]);
      if (hit && (!rows || rows.has(scene.row[k]))) mask[k] = 1;
    }
  } else {
    // A group with no zones or strands of its own is the union of its children.
    for (const child of scene.groups) {
      if (child.parent === g.id) for (const k of groupMembers(scene, child, seen)) mask[k] = 1;
    }
  }
  cached = maskToIndex(mask);
  scene.groupCache.set(g.id, cached);
  return cached;
}

function maskToIndex(mask) {
  let m = 0;
  for (let k = 0; k < mask.length; k++) m += mask[k];
  const out = new Int32Array(m);
  for (let k = 0, j = 0; k < mask.length; k++) if (mask[k]) out[j++] = k;
  return out;
}

/** Pixel indices (ascending, unique) in the union of the groups `ids`. Unknown ids throw. */
export function pixelsForGroups(scene, ids) {
  const list = ids === undefined || ids === null ? ['cathedral'] : Array.isArray(ids) ? ids : [ids];
  if (list.length === 1) {
    const g = scene.groupById.get(list[0]);
    if (!g) throw new Error(`unknown group "${list[0]}"`);
    return groupMembers(scene, g).slice();
  }
  const mask = new Uint8Array(scene.count);
  for (const id of list) {
    const g = scene.groupById.get(id);
    if (!g) throw new Error(`unknown group "${id}"`);
    for (const k of groupMembers(scene, g)) mask[k] = 1;
  }
  return maskToIndex(mask);
}

// The timeline: a look lasts `duration` seconds; a layer with clips is lit only inside them.
export const DEFAULT_DURATION = 30;
export const MIN_DURATION = 1;
export const MAX_DURATION = 600;
export const MAX_CLIPS = 32;

/** A look's length in seconds: `look.duration` held to 1..600, else 30. */
export function lookDuration(look) {
  const d = look && look.duration;
  return isNum(d) ? clamp(d, MIN_DURATION, MAX_DURATION) : DEFAULT_DURATION;
}

/**
 * Clips as the renderer uses them: [{ start, end, fadeIn, fadeOut }], finite, end > start, fades ≥ 0, sorted,
 * at most MAX_CLIPS, overlapping ones dropped; null when there are none (the layer is always on).
 */
export function normalizeClips(clips) {
  if (!Array.isArray(clips) || !clips.length) return null;
  const list = [];
  for (const c of clips) {
    if (!c || typeof c !== 'object') continue;
    const start = +c.start, end = +c.end;
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) continue;
    const fadeIn = +c.fadeIn > 0 && Number.isFinite(+c.fadeIn) ? +c.fadeIn : 0;
    const fadeOut = +c.fadeOut > 0 && Number.isFinite(+c.fadeOut) ? +c.fadeOut : 0;
    list.push({ start, end, fadeIn, fadeOut });
  }
  list.sort((a, b) => a.start - b.start);
  const out = [];
  for (const c of list) {
    if (out.length >= MAX_CLIPS) break;
    if (out.length && c.start < out[out.length - 1].end) continue;
    out.push(c);
  }
  return out.length ? out : null;
}

/**
 * How much of a layer shows at t (0..1): 1 with no clips; in a clip [start, end) a linear ramp up over
 * fadeIn and down over fadeOut (shrunk in proportion when they overrun the clip); 0 outside. No allocation.
 */
export function layerEnvelope(clips, t) {
  if (!clips || !clips.length) return 1;
  let best = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const start = c.start, end = c.end;
    if (!(t >= start && t < end)) continue;
    let fi = c.fadeIn > 0 ? c.fadeIn : 0, fo = c.fadeOut > 0 ? c.fadeOut : 0;
    const len = end - start;
    if (fi + fo > len) { const k = len / (fi + fo); fi *= k; fo *= k; }
    let v = 1;
    if (fi > 0 && t < start + fi) v = (t - start) / fi;
    if (fo > 0 && t > end - fo) { const w = (end - t) / fo; if (w < v) v = w; }
    if (v > best) best = v;
  }
  return best;
}
