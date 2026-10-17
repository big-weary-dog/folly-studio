// Shared data: the cathedral model, the pattern library, group membership, layer helpers.
import { api, fetchJSON } from '../api.js';
import { randomId } from './dom.js';

let cathedralP = null;
export function loadCathedral() {
  if (!cathedralP) {
    cathedralP = fetchJSON('/data/cathedral.json').catch((err) => { cathedralP = null; throw err; });
  }
  return cathedralP;
}

let libraryP = null;
/** [{ name, title, summary, code }] — from /api/library, falling back to /patterns/. */
export function loadLibrary() {
  if (!libraryP) {
    libraryP = api.library()
      .then((r) => (Array.isArray(r.patterns) ? r.patterns : []))
      .catch(async () => {
        const idx = await fetchJSON('/patterns/index.json');
        const list = Array.isArray(idx) ? idx : (idx.patterns || []);
        const out = [];
        for (const entry of list) {
          const meta = typeof entry === 'string' ? { name: entry } : entry;
          try {
            const res = await fetch(`/patterns/${encodeURIComponent(meta.name)}.js`);
            if (res.ok) out.push({ title: meta.name, summary: '', ...meta, code: await res.text() });
          } catch { /* skip */ }
        }
        return out;
      })
      .catch((err) => { libraryP = null; throw err; });
  }
  return libraryP;
}

export const BLEND_MODES = [
  { value: 'add', label: 'Add', help: 'Sums light (default)' },
  { value: 'over', label: 'Over', help: 'Replaces what is below, by alpha × level' },
  { value: 'max', label: 'Max', help: 'Keeps the brighter channel' },
  { value: 'multiply', label: 'Multiply', help: 'Tints what is below' },
];

export const BLANK_CODE = `// A new layer. Describe what it does here.
const params = {
  color: { value: '#5b8cff', type: 'color' },
  speed: { value: 0.5, min: 0, max: 2 },
  width: { value: 0.25, min: 0.02, max: 1 },
};

function pixel(p, t, P) {
  // a soft band of light climbing what this layer lands on
  const v = pulse(fract(p.ly - t * P.speed), P.width);
  return scale(P.color, v);
}
`;

export function makeLayer({ title = 'Layer', code = BLANK_CODE, groups, blend = 'add', level = 1, params = {} } = {}, cathedral) {
  return {
    id: randomId('l'),
    title,
    code,
    groups: groups && groups.length ? [...groups] : [defaultGroupId(cathedral)],
    blend,
    level,
    params: { ...params },
  };
}

export function layerFromPattern(pattern, cathedral) {
  return makeLayer({ title: pattern.title || pattern.name || 'Layer', code: pattern.code || BLANK_CODE }, cathedral);
}

export function defaultGroupId(cathedral) {
  const groups = cathedral?.groups || [];
  if (groups.some((g) => g.id === 'cathedral')) return 'cathedral';
  const root = groups.find((g) => !g.parent);
  return root ? root.id : 'cathedral';
}

/** Only the fields a saved look keeps (SPEC "Looks"). */
export function cleanLayer(l) {
  return {
    id: String(l.id),
    title: String(l.title || 'Layer'),
    code: String(l.code || ''),
    groups: Array.isArray(l.groups) ? [...l.groups] : [],
    blend: BLEND_MODES.some((b) => b.value === l.blend) ? l.blend : 'add',
    level: Number.isFinite(+l.level) ? Math.min(1, Math.max(0, +l.level)) : 1,
    params: l.params && typeof l.params === 'object' ? { ...l.params } : {},
    // Timeline clips pass through untouched (the server validates them).
    ...(Array.isArray(l.clips) ? { clips: l.clips.map((c) => ({ ...c })) } : {}),
  };
}

/** Normalise layers from the server or a file: ids unique, fields present. */
export function normaliseLayers(layers, cathedral) {
  const seen = new Set();
  return (Array.isArray(layers) ? layers : []).map((l) => {
    const c = cleanLayer(l || {});
    if (!c.id || seen.has(c.id)) c.id = randomId('l');
    seen.add(c.id);
    if (!c.groups.length) c.groups = [defaultGroupId(cathedral)];
    return c;
  });
}

// ---- groups -----------------------------------------------------------------------------

/** Precomputed group masks: Map id → Uint8Array(count). */
export function buildGroupIndex(cathedral) {
  const { count, zones: zoneNames = [], pixels } = cathedral;
  const zoneOf = (z) => (typeof z === 'number' ? z : zoneNames.indexOf(z));
  const masks = new Map();
  const counts = new Map();
  for (const g of cathedral.groups || []) {
    const zones = new Set((g.zones || []).map(zoneOf));
    const strands = new Set(g.strands || []);
    const rows = Array.isArray(g.rows) && g.rows.length ? new Set(g.rows) : null;
    const m = new Uint8Array(count);
    let n = 0;
    for (let i = 0; i < count; i++) {
      let hit = zones.has(pixels.zone[i]) || strands.has(pixels.strand[i]);
      if (hit && rows) hit = rows.has(pixels.row[i]);
      if (hit) { m[i] = 1; n++; }
    }
    masks.set(g.id, m);
    counts.set(g.id, n);
  }
  const children = new Map();
  for (const g of cathedral.groups || []) {
    const p = g.parent ?? null;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(g);
  }
  const byId = new Map((cathedral.groups || []).map((g) => [g.id, g]));
  return {
    masks, counts, children, byId,
    /** Union mask of several group ids (null if none). */
    union(ids) {
      const list = (ids || []).map((id) => masks.get(id)).filter(Boolean);
      if (!list.length) return null;
      if (list.length === 1) return list[0];
      const out = new Uint8Array(count);
      for (const m of list) for (let i = 0; i < count; i++) out[i] |= m[i];
      return out;
    },
    countOf(ids) {
      const u = this.union(ids);
      if (!u) return 0;
      let n = 0;
      for (let i = 0; i < count; i++) n += u[i];
      return n;
    },
    ancestors(id) {
      const out = [];
      let g = byId.get(id);
      while (g && g.parent) { out.push(g.parent); g = byId.get(g.parent); }
      return out;
    },
  };
}
