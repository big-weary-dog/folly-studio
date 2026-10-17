// Layers: prepared from a scene, rendered and blended into a frame, then mapped to DMX channels.
import { describeError } from './compile.js';
import { layerEnvelope, normalizeClips, pixelsForGroups } from './scene.js';
import { clamp, hex, isNum, TAU } from './stdlib.js';

export const BLENDS = Object.freeze(['add', 'over', 'max', 'multiply']);

/** Current values P from a schema and a layer's overrides (colours become [r, g, b]). */
export function resolveParams(schema, overrides) {
  const P = {};
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  for (const key of Object.keys(schema || {})) {
    const d = schema[key];
    const has = Object.prototype.hasOwnProperty.call(o, key) && o[key] !== null && o[key] !== undefined;
    const v = has ? o[key] : d.value;
    if (d.type === 'color') {
      let c;
      if (Array.isArray(v) && v.length >= 3) c = [+v[0] || 0, +v[1] || 0, +v[2] || 0];
      else { try { c = hex(v); } catch { c = hex(d.value); } }
      P[key] = c;
    } else if (d.type === 'toggle') {
      P[key] = !!v;
    } else {
      const n = +v;
      P[key] = Number.isFinite(n) ? n : d.value;
    }
  }
  return P;
}

const makePixel = () => ({ x: 0, y: 0, z: 0, X: 0, Y: 0, Z: 0, lx: 0, ly: 0, lz: 0, a: 0, r: 0, u: 0, i: 0, n: 1,
  zone: '', zi: 0, strand: 0, row: 0, petal: -1, k: 0, seed: 0 });

/**
 * A layer ready to render: its pixels (`groups`, default the whole cathedral), lx/ly/lz (0..1 across its own
 * bounds; 0.5 on a flat axis), a/r round their centre in the façade (z–y) plane, its params and its clips.
 */
export function prepareLayer(scene, layer, compiled) {
  if (!compiled || typeof compiled.pixel !== 'function') throw new Error('prepareLayer: layer is not compiled');
  const given = layer && layer.groups && (Array.isArray(layer.groups) ? layer.groups.length : true);
  const groups = given ? layer.groups : ['cathedral'];
  const idx = pixelsForGroups(scene, groups);
  const m = idx.length;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let j = 0; j < m; j++) {
    const k = idx[j];
    const X = scene.X[k], Y = scene.Y[k], Z = scene.Z[k];
    if (X < x0) x0 = X; if (X > x1) x1 = X;
    if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    if (Z < z0) z0 = Z; if (Z > z1) z1 = Z;
  }
  const norm = (v, lo, hi) => (hi - lo > 1e-6 ? (v - lo) / (hi - lo) : 0.5);
  const cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const lx = new Float64Array(m), ly = new Float64Array(m), lz = new Float64Array(m);
  const a = new Float64Array(m), r = new Float64Array(m);
  let rmax = 0;
  for (let j = 0; j < m; j++) {
    const k = idx[j];
    lx[j] = norm(scene.X[k], x0, x1); ly[j] = norm(scene.Y[k], y0, y1); lz[j] = norm(scene.Z[k], z0, z1);
    // Seen from the playa (at -x, looking toward +x) up is +y and the viewer's right is +z, so
    // atan2(dz, dy) runs clockwise from 12 o'clock: 3 o'clock (+z) is a = 0.25.
    const dz = scene.Z[k] - cz, dy = scene.Y[k] - cy;
    const ang = Math.atan2(dz, dy) / TAU;
    a[j] = ang < 0 ? ang + 1 : ang;
    r[j] = Math.sqrt(dz * dz + dy * dy);
    if (r[j] > rmax) rmax = r[j];
  }
  if (rmax > 0) for (let j = 0; j < m; j++) r[j] /= rmax;
  const level = layer && isNum(layer.level) ? clamp(layer.level) : 1;
  const blend = layer && BLENDS.includes(layer.blend) ? layer.blend : 'add';
  return {
    id: layer && layer.id !== undefined ? layer.id : null,
    idx, lx, ly, lz, a, r,
    bounds: { min: [x0, y0, z0], max: [x1, y1, z1] },
    pixel: compiled.pixel, frame: compiled.frame || null,
    schema: compiled.params || {},
    P: resolveParams(compiled.params, layer && layer.params),
    blend, level,
    clips: normalizeClips(layer && layer.clips),
    enabled: !(layer && layer.enabled === false),
    p: makePixel(),
    buf: new Float64Array(m * 4),
  };
}

// Runs one layer into its own rgba buffer. Returns an error string, or null.
function runLayer(S, L, t) {
  const idx = L.idx, m = idx.length, buf = L.buf, p = L.p, P = L.P, fn = L.pixel;
  const zones = S.zones;
  let j = 0;
  try {
    if (L.frame) L.frame(t, P);
    for (; j < m; j++) {
      const k = idx[j];
      p.x = S.x[k]; p.y = S.y[k]; p.z = S.z[k];
      p.X = S.X[k]; p.Y = S.Y[k]; p.Z = S.Z[k];
      p.lx = L.lx[j]; p.ly = L.ly[j]; p.lz = L.lz[j];
      p.a = L.a[j]; p.r = L.r[j];
      p.u = S.u[k]; p.i = S.i[k]; p.n = S.n[k];
      const zi = S.zone[k];
      p.zi = zi; p.zone = zones[zi]; p.strand = S.strand[k];
      p.row = S.row[k]; p.petal = S.petal[k];
      p.k = k; p.seed = S.seed[k];
      let c = fn(p, t, P);
      let r, g, b, al;
      if (c === undefined || c === null) { r = g = b = al = 0; }
      else {
        if (typeof c === 'number') { r = g = b = c; al = 1; }
        else {
          if (typeof c === 'string') c = hex(c);
          r = +c[0]; g = +c[1]; b = +c[2];
          al = c.length > 3 && c[3] !== undefined ? +c[3] : 1;
        }
        if (r !== r || g !== g || b !== b || al !== al) {
          const said = Array.isArray(c) ? `[${Array.from(c).slice(0, 4).join(', ')}]` : String(c);
          return `pixel() returned ${said} (NaN) at LED ${k}`;
        }
      }
      const o = 4 * j;
      buf[o] = r < 0 ? 0 : r > 1 ? 1 : r;
      buf[o + 1] = g < 0 ? 0 : g > 1 ? 1 : g;
      buf[o + 2] = b < 0 ? 0 : b > 1 ? 1 : b;
      buf[o + 3] = al < 0 ? 0 : al > 1 ? 1 : al;
    }
  } catch (e) {
    return describeError(e);
  }
  return null;
}

/**
 * Every prepared layer at time t (s), bottom to top, into Float32Array(count × 3) of linear 0..1 RGB. A layer
 * that throws or returns NaN adds nothing and is reported in `errors` as { id, error }. Clips scale a layer's
 * level; outside them it does not run at all. `t` stays show time, so motion carries on across a cut.
 */
export function renderFrame(scene, layers, t, out) {
  const N = scene.count;
  const rgb = out && out.length >= N * 3 ? out : new Float32Array(N * 3);
  rgb.fill(0, 0, N * 3);
  const errors = [];
  const list = layers || [];
  for (let n = 0; n < list.length; n++) {
    const L = list[n];
    if (!L || !L.pixel || !L.enabled || !(L.level > 0)) continue;
    const level = L.clips ? L.level * layerEnvelope(L.clips, t) : L.level;
    if (!(level > 0)) continue;
    const err = runLayer(scene, L, t);
    if (err) { errors.push({ id: L.id, error: err }); continue; }
    const idx = L.idx, m = idx.length, buf = L.buf;
    switch (L.blend) {
      case 'over':
        for (let j = 0; j < m; j++) {
          const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level, ia = 1 - a;
          rgb[o] = rgb[o] * ia + buf[q] * a;
          rgb[o + 1] = rgb[o + 1] * ia + buf[q + 1] * a;
          rgb[o + 2] = rgb[o + 2] * ia + buf[q + 2] * a;
        }
        break;
      case 'max':
        for (let j = 0; j < m; j++) {
          const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level;
          const r = buf[q] * a, g = buf[q + 1] * a, b = buf[q + 2] * a;
          if (r > rgb[o]) rgb[o] = r;
          if (g > rgb[o + 1]) rgb[o + 1] = g;
          if (b > rgb[o + 2]) rgb[o + 2] = b;
        }
        break;
      case 'multiply':
        for (let j = 0; j < m; j++) {
          const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level, ia = 1 - a;
          rgb[o] *= ia + buf[q] * a;
          rgb[o + 1] *= ia + buf[q + 1] * a;
          rgb[o + 2] *= ia + buf[q + 2] * a;
        }
        break;
      default: // add
        for (let j = 0; j < m; j++) {
          const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level;
          rgb[o] += buf[q] * a;
          rgb[o + 1] += buf[q + 1] * a;
          rgb[o + 2] += buf[q + 2] * a;
        }
    }
  }
  for (let i = 0; i < N * 3; i++) {
    const v = rgb[i];
    if (!(v > 0)) rgb[i] = 0; else if (v > 1) rgb[i] = 1;
  }
  return { rgb, errors };
}

/**
 * A frame of DMX: Uint8Array(universes × channelsPerUniverse), each LED's R, G, B at (universe − 1) × 510 +
 * (channel − 1). Brightness scales, gamma bends (v ** gamma), values round to 0..255; unused channels stay 0.
 */
export function toChannels(scene, rgb, out, opts) {
  if (out && !ArrayBuffer.isView(out) && opts === undefined) { opts = out; out = undefined; }
  const gamma = opts && isNum(opts.gamma) && opts.gamma > 0 ? opts.gamma : 1;
  const brightness = opts && isNum(opts.brightness) ? Math.max(0, opts.brightness) : 1;
  const size = scene.frameChannels;
  const ch = out && out.length >= size ? out : new Uint8Array(size);
  ch.fill(0, 0, size);
  const addr = scene.addr, N = scene.count;
  for (let k = 0; k < N; k++) {
    const base = addr[k];
    if (base < 0 || base + 2 >= size) continue;
    for (let c = 0; c < 3; c++) {
      let v = rgb[3 * k + c] * brightness;
      v = v > 0 ? (v < 1 ? v : 1) : 0;
      if (gamma !== 1) v = Math.pow(v, gamma);
      ch[base + c] = Math.round(v * 255);
    }
  }
  return ch;
}
