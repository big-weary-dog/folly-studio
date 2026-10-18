// The scene: a rig (SPEC "Rig") as typed arrays in the pattern frame (x depth front → back, y up, z left →
// right), its fixtures, attrs, groups and tags, and the regions the flash checks watch.
import { hash } from './stdlib.js';

const AXIS = /^([+-])([xyz])$/;
const ORDERS = ['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR'];
const bad = (msg) => { throw new Error(`prepareScene: ${msg}`); };
const int = (v, lo = 1) => Number.isInteger(v) && v >= lo;

/** For depth, up and right: [rig axis index, sign]. Depth runs away from the front. */
function frameOf(axes = {}) {
  const [front, up, right] = ['front', 'up', 'right'].map((k) => {
    const m = AXIS.exec(axes[k] ?? { front: '-x', up: '+y', right: '+z' }[k]) || bad(`axes.${k} must be ±x, ±y or ±z`);
    return ['xyz'.indexOf(m[2]), m[1] === '+' ? 1 : -1];
  });
  if (new Set([front[0], up[0], right[0]]).size < 3) bad('axes must name three different axes');
  return [[front[0], -front[1]], up, right];
}

/** rig.json → a scene of typed arrays (pixel order), shared by every layer. Throws on a malformed rig. */
export function prepareScene(rig) {
  if (!rig || !rig.pixels || !Array.isArray(rig.fixtures)) bad('not a rig (SPEC "Rig")');
  const N = rig.count, px = rig.pixels, out = rig.output || {};
  if (!int(N, 0)) bad('count must be a whole number');
  for (const k of ['universe', 'channel']) if (px[k]?.length !== N) bad(`pixels.${k} must have ${N} entries`);
  if (px.pos?.length !== N * 3) bad(`pixels.pos must have ${N * 3} entries`);
  const cpu = out.channelsPerUniverse, universes = out.universes, order = out.order ?? 'RGB';
  if (!int(cpu, 3) || !int(universes)) bad('output needs universes and channelsPerUniverse');
  if (!rig.bounds?.min || !rig.bounds.max) bad('bounds needs min and max');
  if (!ORDERS.includes(order)) bad(`output.order must be one of ${ORDERS.join(', ')}`);
  const frame = frameOf(rig.axes);
  const lo = frame.map(([a, s]) => (s > 0 ? rig.bounds.min[a] : -rig.bounds.max[a]));
  const hi = frame.map(([a, s]) => (s > 0 ? rig.bounds.max[a] : -rig.bounds.min[a]));
  const span = [0, 1, 2].map((i) => (hi[i] - lo[i]) || 1);
  const F = () => new Float64Array(N), I = () => new Int32Array(N);
  const zones = [], zoneIndex = new Map(), fixtureIndex = new Map(), groups = rig.groups || [];
  const attrs = new Map(Object.entries(px.attrs || {}).map(([name, v]) => {
    if (v?.length !== N) bad(`pixels.attrs.${name} must have ${N} entries`);
    return [name, Float64Array.from(v)];
  }));
  const s = {
    rig, count: N, channelsPerUniverse: cpu, universes, frameChannels: universes * cpu, fps: out.fps || 40,
    order: [...'RGB'].map((c) => order.indexOf(c)), frame, bounds: { min: lo, max: hi }, zones, zoneIndex,
    fixtures: rig.fixtures, fixtureIndex, attrs, groups, groupById: new Map(groups.map((g) => [g.id, g])),
    root: groups.find((g) => g.parent == null) || null, groupCache: new Map(), tagCache: new Map(),
    X: F(), Y: F(), Z: F(), x: F(), y: F(), z: F(), zone: I(), fixture: I(),
    ring: attrs.get('ring') || F(), sector: attrs.get('sector') || F().fill(-1),
    u: F(), i: I(), n: I(), seed: F(), addr: I(), centresOf: (tag) => tagCentres(s, tag),
  };
  let next = 0;
  rig.fixtures.forEach((f, j) => {
    if (f.start !== next || !int(f.count, 0)) bad(`fixture ${f.id} must start at ${next} (fixtures tile the pixels)`);
    const zone = f.zone ?? f.id;
    if (!zoneIndex.has(zone)) { zoneIndex.set(zone, zones.length); zones.push(zone); }
    fixtureIndex.set(f.id, j);
    for (let i = 0, n = f.count, k = next; i < n; i++, k++) {
      s.zone[k] = zoneIndex.get(zone); s.fixture[k] = j; s.i[k] = i; s.n[k] = n; s.u[k] = n > 1 ? i / (n - 1) : 0;
    }
    next += f.count;
  });
  if (next !== N) bad(`fixtures cover ${next} of ${N} pixels`);
  const P = [s.X, s.Y, s.Z], p = [s.x, s.y, s.z];
  for (let k = 0; k < N; k++) {
    for (let c = 0; c < 3; c++) {
      const [a, sign] = frame[c], v = sign * px.pos[3 * k + a];
      P[c][k] = v; p[c][k] = (v - lo[c]) / span[c];
    }
    s.seed[k] = hash(k * 7919 + 13);
    s.addr[k] = (px.universe[k] - 1) * cpu + (px.channel[k] - 1);
  }
  return s;
}

function groupMembers(scene, g, seen = new Set()) {
  let cached = scene.groupCache.get(g.id);
  if (cached) return cached;
  if (seen.has(g.id)) return new Int32Array(0);
  seen.add(g.id);
  const N = scene.count, mask = new Uint8Array(N);
  const fixtures = new Set((g.fixtures || []).map((id) => scene.fixtureIndex.get(id)));
  const zones = new Set((g.zones || []).map((z) => scene.zoneIndex.get(z)));
  const where = Object.entries(g.where || {}).map(([a, vs]) => [scene.attrs.get(a), new Set(vs)]);
  const any = !fixtures.size && !zones.size;
  if (!any || where.length) {
    for (let k = 0; k < N; k++) {
      if ((any || fixtures.has(scene.fixture[k]) || zones.has(scene.zone[k]))
        && where.every(([v, set]) => v && set.has(v[k]))) mask[k] = 1;
    }
  } else {
    // A group with no fixtures, zones or where of its own is the union of its children.
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

const members = (scene, id) => (scene.groupById.has(id) ? groupMembers(scene, scene.groupById.get(id))
  : Int32Array.from({ length: scene.count }, (_, k) => k)); // a rig without groups: all of it

/** Groups tagged `tag`, outermost first (cached). */
export function groupsByTag(scene, tag) {
  let list = scene.tagCache.get(tag);
  if (!list) {
    const depth = (g) => {
      let d = 0;
      for (let p = g; p?.parent != null && d < 64; d++) p = scene.groupById.get(p.parent);
      return d;
    };
    list = scene.groups.filter((g) => Array.isArray(g.tags) && g.tags.includes(tag))
      .map((g) => [depth(g), g]).sort((a, b) => a[0] - b[0]).map(([, g]) => g);
    scene.tagCache.set(tag, list);
  }
  return list;
}

/**
 * A layer's pixels (ascending, unique): its group ids; when it names none, or one this rig lacks, the known ones
 * plus the groups tagged with any of `tags`; nothing at all: the root. An unknown id without tags throws.
 */
export function pixelsForGroups(scene, ids, tags) {
  const list = ids == null ? [] : Array.isArray(ids) ? ids : [ids];
  let use = list.filter((id) => scene.groupById.has(id));
  if (use.length < list.length || !list.length) {
    const tagged = Array.isArray(tags) && tags.length ? tags.flatMap((t) => groupsByTag(scene, t)) : null;
    if (tagged) use = use.concat(tagged.map((g) => g.id));
    else if (list.length) throw new Error(`unknown group "${list.find((id) => !scene.groupById.has(id))}"`);
    else use = [scene.root?.id];
  }
  if (use.length === 1) return members(scene, use[0]).slice();
  const mask = new Uint8Array(scene.count);
  for (const id of use) for (const k of members(scene, id)) mask[k] = 1;
  return maskToIndex(mask);
}

/** 1 where a pixel is in a group tagged `tag` (cached). */
export function tagMask(scene, tag) {
  const key = `#${tag}`;
  let mask = scene.tagCache.get(key);
  if (!mask) {
    mask = new Uint8Array(scene.count);
    for (const g of groupsByTag(scene, tag)) for (const k of groupMembers(scene, g)) mask[k] = 1;
    scene.tagCache.set(key, mask);
  }
  return mask;
}

/** Each group tagged `tag`: its `centre` (else its pixels' middle) as a frozen [X, Y, Z] (cached). */
export function tagCentres(scene, tag) {
  const key = `@${tag}`;
  let list = scene.tagCache.get(key);
  if (!list) {
    list = Object.freeze(groupsByTag(scene, tag).map((g) => {
      if (Array.isArray(g.centre)) return Object.freeze(scene.frame.map(([a, s]) => s * g.centre[a]));
      const idx = groupMembers(scene, g), P = [scene.X, scene.Y, scene.Z];
      return Object.freeze(P.map((v) => {
        let a = Infinity, b = -Infinity;
        for (const k of idx) { if (v[k] < a) a = v[k]; if (v[k] > b) b = v[k]; }
        return idx.length ? (a + b) / 2 : 0;
      }));
    }));
    scene.tagCache.set(key, list);
  }
  return list;
}

export const LARGE = Object.freeze({ share: 0.1, extent: 0.1, grid: 32 });

/**
 * The flash checks' regions (SPEC "Baked frames"): the whole rig (idx null), then each lit top-level group, and
 * whether each is large: the whole, ≥ 10 % of the LEDs, or ≥ 10 % of the lit cells (1/32 of the bounds' diagonal)
 * seen from the front (z, y) or the side (x, y).
 */
export function flashRegions(scene) {
  const N = scene.count, root = scene.root, regions = [{ id: root ? root.id : 'all', idx: null }];
  for (const g of scene.groups) {
    const idx = root && g.parent === root.id ? groupMembers(scene, g) : [];
    if (idx.length) regions.push({ id: g.id, idx: idx.slice() });
  }
  const { min: lo, max: hi } = scene.bounds, P = [scene.X, scene.Y, scene.Z];
  const cell = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / LARGE.grid || 1;
  const at = (k, a) => Math.floor((P[a][k] - lo[a]) / cell);
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
  return regions.map((r) => ({ ...r, large: !r.idx || r.idx.length >= LARGE.share * N
    || views.some((view, i) => area(r.idx, view) >= LARGE.extent * whole[i]) }));
}
