// Layers: prepared from a scene, rendered (each its module chain) and blended into a frame, graded by the look's
// globals, then mapped to DMX channels.
import { prepareChain, runChain } from './chain.js';
import { finish, lookFrame, prepareLook } from './globals.js';
import { applyMods } from './modulate.js';
import { layerEnvelope, normalizeClips, pixelsForGroups } from './scene.js';
import { clamp, isNum, TAU } from './stdlib.js';

export const BLENDS = Object.freeze(['add', 'over', 'max', 'multiply']);
const makePixel = () => ({ x: 0, y: 0, z: 0, X: 0, Y: 0, Z: 0, lx: 0, ly: 0, lz: 0, a: 0, r: 0, u: 0, i: 0, n: 1,
  zone: '', zi: 0, strand: 0, row: 0, petal: -1, k: 0, seed: 0 });

/**
 * A layer ready to render: its pixels (`groups`, default the whole cathedral), lx/ly/lz (0..1 across its own
 * bounds; 0.5 on a flat axis), a/r round their centre in the façade (z–y) plane, its module chain (`compiled`: one
 * compilePattern result for a layer with code, or compileLayer's list) and its clips.
 */
export function prepareLayer(scene, layer, compiled) {
  if (!compiled) throw new Error('prepareLayer: layer is not compiled');
  const chain = prepareChain(layer, compiled);
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
    chain, modular: !!(layer && Array.isArray(layer.modules)), failed: null,
    blend, level,
    clips: normalizeClips(layer && layer.clips),
    enabled: !(layer && layer.enabled === false),
    p: makePixel(), c: [0.5, 0, 0, 0],
    buf: new Float64Array(m * 4),
  };
}

let plainLook = null;

/**
 * Every prepared layer at show time t (s), bottom to top, into Float32Array(count × 3) of linear 0..1 RGB, graded
 * by `look` (prepareLook; default: no globals). A layer that throws or returns NaN adds nothing and is reported in
 * `errors` as { id, module?, error }. Clips scale a layer's level; outside them it does not run at all. Patterns
 * get the look's clock (show time at speed 1), so motion carries on across a cut.
 */
export function renderFrame(scene, layers, t, out, look) {
  const N = scene.count;
  const rgb = out && out.length >= N * 3 ? out : new Float32Array(N * 3);
  rgb.fill(0, 0, N * 3);
  const errors = [];
  const list = layers || [];
  const LK = look || (plainLook ||= prepareLook(null));
  lookFrame(LK, t);
  const T = look ? LK.T : t, G = LK.G;
  for (let n = 0; n < list.length; n++) {
    const L = list[n];
    if (!L || !L.chain || !L.enabled || !(L.level > 0)) continue;
    const env = L.clips ? layerEnvelope(L.clips, t) : 1;
    const level = L.level * env;
    if (!(level > 0)) continue;
    for (let i = 0; i < L.chain.length; i++) {
      const M = L.chain[i];
      if (M.mods.length) applyMods(M.mods, M.P, t, env, LK);
    }
    const err = runChain(scene, L, T, G);
    if (err) {
      errors.push(L.modular ? { id: L.id, module: L.failed, error: err } : { id: L.id, error: err });
      continue;
    }
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
  finish(rgb, N * 3, LK);
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
