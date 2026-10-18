// Layers (SPEC "Modules"): each a module chain run over its pixels in one pass (warps move the pixel, sources draw
// and combine, filters rework the colour), blended into a frame, graded by the look's globals, mapped to DMX.
import { compileModule, describeError } from './compile.js';
import { applyMods, finish, lookFrame, paramMods, prepareLook, resolveParams } from './globals.js';
import { pixelsForGroups, tagMask } from './scene.js';
import { clamp, hex, isNum, RUN, TAU } from './stdlib.js';
import { layerEnvelope, normalizeClips } from './timeline.js';

export const MODULE_KINDS = Object.freeze(['source', 'warp', 'filter']);
const SOURCE = 0, WARP = 1, FILTER = 2;
const OVER = 0, ADD = 1, MAX = 2, MULTIPLY = 3;
const BLEND = { over: OVER, add: ADD, max: MAX, multiply: MULTIPLY };

/** A layer's modules, or its own code and params as one source (looks before chains). */
export function layerModules(layer) {
  if (layer && Array.isArray(layer.modules)) return layer.modules.filter((m) => m && typeof m === 'object');
  return [{ id: 'm1', kind: 'source', title: (layer && layer.title) || 'Pattern', code: layer && layer.code,
    params: layer && layer.params }];
}

const isOn = (m) => m.enabled !== false;

/** Each module compiled (null where disabled). Throws on the first failure, as "<module title>: …" in a chain. */
export function compileLayer(layer) {
  const modular = !!(layer && Array.isArray(layer.modules));
  return layerModules(layer).map((m) => {
    if (!isOn(m)) return null;
    try {
      return compileModule(m.code, m.kind ?? 'source');
    } catch (e) {
      if (!modular) throw e;
      throw new Error(`${m.title || m.id || 'Module'}: ${e && e.message ? e.message : e}`, { cause: e });
    }
  });
}

/** The runnable chain: enabled modules with their function, params, bindings, blend, input (index or −1). */
function prepareChain(layer, compiled) {
  const modules = layerModules(layer);
  const list = Array.isArray(compiled) ? compiled : [compiled];
  if (list.length !== modules.length) throw new Error('prepareLayer: compile every module (compileLayer)');
  const chain = [], at = new Map();
  let shown = 0;
  modules.forEach((m, i) => {
    if (!isOn(m)) return;
    const c = list[i];
    const kind = MODULE_KINDS.indexOf(m.kind ?? 'source');
    const fn = c && (kind === SOURCE ? c.pixel : kind === WARP ? c.warp : c.filter);
    if (typeof fn !== 'function') throw new Error('prepareLayer: layer is not compiled');
    const hidden = kind === SOURCE && m.as === 'input';
    const blend = m.blend in BLEND ? BLEND[m.blend] : shown ? ADD : OVER;
    if (kind === SOURCE && !hidden) shown++;
    const input = kind === FILTER && at.has(m.input) ? at.get(m.input) : -1;
    if (kind === SOURCE) at.set(m.id, chain.length);
    chain.push({ id: m.id ?? null, title: m.title || m.id || '', kind, fn, frame: c.frame || null,
      schema: c.params || {}, P: resolveParams(c.params, m.params), mods: paramMods(c.params, m.params),
      blend, hidden, input, out: [0.5, 0, 0, 0] });
  });
  return chain;
}

/** v (number, '#hex', [r, g, b, a?], nothing) into out as [r, g, b, a], alpha default `da`. False on NaN. */
function toColour(v, out, da) {
  let r, g, b, al;
  if (v === undefined || v === null) { r = g = b = al = 0; }
  else if (typeof v === 'number') { r = g = b = v; al = da; }
  else {
    if (typeof v === 'string') v = hex(v);
    r = +v[0]; g = +v[1]; b = +v[2];
    al = v.length > 3 && v[3] !== undefined ? +v[3] : da;
  }
  if (r !== r || g !== g || b !== b || al !== al) return false;
  out[0] = r; out[1] = g; out[2] = b; out[3] = al < 0 ? 0 : al > 1 ? 1 : al;
  return true;
}

/** o into c (straight alpha) by blend; onto nothing it is simply o. */
function blendInto(c, o, mode) {
  const a = o[3], ca = c[3];
  if (mode === MULTIPLY) {
    for (let i = 0; i < 3; i++) c[i] *= 1 - a + o[i] * a;
    return;
  }
  if (!(ca > 0)) { c[0] = o[0]; c[1] = o[1]; c[2] = o[2]; c[3] = a; return; }
  if (mode === OVER) {
    const keep = ca * (1 - a), A = a + keep;
    for (let i = 0; i < 3; i++) c[i] = (o[i] * a + c[i] * keep) / A;
    c[3] = A;
  } else if (mode === ADD) {
    const A = ca + a < 1 ? ca + a : 1;
    for (let i = 0; i < 3; i++) c[i] = (c[i] * ca + o[i] * a) / A;
    c[3] = A;
  } else {
    const A = a > ca ? a : ca;
    for (let i = 0; i < 3; i++) { const x = c[i] * ca, y = o[i] * a; c[i] = (x > y ? x : y) / A; }
    c[3] = A;
  }
}

const said = (v) => (Array.isArray(v) ? `[${Array.from(v).slice(0, 4).join(', ')}]` : String(v));

/** Layer L's chain at pattern time T into L.buf (rgba) → null, or an error (its module in L.failed). */
function runChain(S, L, T, G) {
  const idx = L.idx, m = idx.length, buf = L.buf, q = L.p, chain = L.chain, n = chain.length, c = L.c;
  const zones = S.zones;
  let j = 0, M = null;
  try {
    for (let i = 0; i < n; i++) { M = chain[i]; if (M.frame) M.frame(T, M.P, G); }
    for (; j < m; j++) {
      const k = idx[j];
      q.x = S.x[k]; q.y = S.y[k]; q.z = S.z[k];
      q.X = S.X[k]; q.Y = S.Y[k]; q.Z = S.Z[k];
      q.lx = L.lx[j]; q.ly = L.ly[j]; q.lz = L.lz[j];
      q.a = L.a[j]; q.r = L.r[j];
      q.u = S.u[k]; q.i = S.i[k]; q.n = S.n[k];
      const zi = S.zone[k];
      q.zi = zi; q.zone = zones[zi]; q.fixture = q.strand = S.fixture[k];
      q.ring = q.row = S.ring[k]; q.sector = q.petal = S.sector[k];
      q.k = k; q.seed = S.seed[k];
      c[0] = c[1] = c[2] = c[3] = 0;
      for (let i = 0; i < n; i++) {
        M = chain[i];
        if (M.kind === WARP) { M.fn(q, T, M.P, G); continue; }
        if (M.kind === SOURCE) {
          const v = M.fn(q, T, M.P, G);
          if (!toColour(v, M.out, 1)) return fail(L, M, `pixel() returned ${said(v)} (NaN) at LED ${k}`);
          if (!M.hidden) blendInto(c, M.out, M.blend);
        } else {
          const v = M.fn(c, q, T, M.P, G, M.input >= 0 ? chain[M.input].out : undefined);
          if (!toColour(v, c, c[3])) return fail(L, M, `filter() returned ${said(v)} (NaN) at LED ${k}`);
        }
      }
      const o = 4 * j;
      const r = c[0], g = c[1], b = c[2], al = c[3];
      buf[o] = r < 0 ? 0 : r > 1 ? 1 : r;
      buf[o + 1] = g < 0 ? 0 : g > 1 ? 1 : g;
      buf[o + 2] = b < 0 ? 0 : b > 1 ? 1 : b;
      buf[o + 3] = al;
    }
  } catch (e) {
    return fail(L, M, describeError(e));
  }
  return null;
}

function fail(L, M, msg) {
  L.failed = M ? M.id : null;
  return L.modular && M ? `${M.title}: ${msg}` : msg;
}

export const BLENDS = Object.freeze(['add', 'over', 'max', 'multiply']);
/** The pixel a layer's chain sees (SPEC "The pixel p"), reused for every LED; `attr` and `is` read its k. */
function makePixel(S) {
  const q = { x: 0, y: 0, z: 0, X: 0, Y: 0, Z: 0, lx: 0, ly: 0, lz: 0, a: 0, r: 0, u: 0, i: 0, n: 1, zone: '', zi: 0,
    fixture: 0, strand: 0, ring: 0, row: 0, sector: -1, petal: -1, k: 0, seed: 0 };
  q.attr = (name, d = 0) => { const v = S.attrs.get(name); return v ? v[q.k] : d; };
  q.is = (tag) => tagMask(S, tag)[q.k] === 1;
  return q;
}

/** A layer ready to render: its pixels, their lx/ly/lz (0.5 on a flat axis) and a/r, its chain and clips. */
export function prepareLayer(scene, layer, compiled) {
  if (!compiled) throw new Error('prepareLayer: layer is not compiled');
  const chain = prepareChain(layer, compiled);
  const idx = pixelsForGroups(scene, layer && layer.groups, layer && layer.tags);
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
    p: makePixel(scene), c: [0.5, 0, 0, 0],
    buf: new Float64Array(m * 4), ms: 0,
  };
}

let plainLook = null;
// Captured before any pattern code runs, so a pattern cannot fake its own timing.
const clock = globalThis.performance ? performance.now.bind(performance) : Date.now;

/**
 * Every prepared layer at show time t, bottom to top, into rgb (count × 3, 0..1), graded by `look` (prepareLook).
 * A failing layer adds nothing and is reported in `errors`; outside its clips it does not run. L.ms: its time.
 */
export function renderFrame(scene, layers, t, out, look) {
  const N = scene.count;
  const rgb = out && out.length >= N * 3 ? out : new Float32Array(N * 3);
  rgb.fill(0, 0, N * 3);
  const errors = [];
  const list = layers || [];
  const LK = look || (plainLook ||= prepareLook(null));
  lookFrame(LK, t);
  RUN.scene = scene;
  const T = look ? LK.T : t, G = LK.G;
  for (let n = 0; n < list.length; n++) {
    const L = list[n];
    if (!L || !L.chain) continue;
    L.ms = 0;
    const env = L.clips ? layerEnvelope(L.clips, t) : 1, level = L.enabled ? L.level * env : 0;
    if (!(level > 0)) continue;
    const t0 = clock();
    for (let i = 0; i < L.chain.length; i++) {
      const M = L.chain[i];
      if (M.mods.length) applyMods(M.mods, M.P, t, env, LK);
    }
    const err = runChain(scene, L, T, G);
    if (err) errors.push(L.modular ? { id: L.id, module: L.failed, error: err } : { id: L.id, error: err });
    else composite(rgb, L, level);
    L.ms = clock() - t0;
  }
  finish(rgb, N * 3, LK);
  return { rgb, errors };
}


function composite(rgb, L, level) {
  const idx = L.idx, m = idx.length, buf = L.buf;
  switch (L.blend) {
    case 'over':
      for (let j = 0; j < m; j++) {
        const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level, ia = 1 - a;
        for (let c = 0; c < 3; c++) rgb[o + c] = rgb[o + c] * ia + buf[q + c] * a;
      }
      break;
    case 'max':
      for (let j = 0; j < m; j++) {
        const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level;
        for (let c = 0; c < 3; c++) { const v = buf[q + c] * a; if (v > rgb[o + c]) rgb[o + c] = v; }
      }
      break;
    case 'multiply':
      for (let j = 0; j < m; j++) {
        const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level, ia = 1 - a;
        for (let c = 0; c < 3; c++) rgb[o + c] *= ia + buf[q + c] * a;
      }
      break;
    default: // add
      for (let j = 0; j < m; j++) {
        const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level;
        for (let c = 0; c < 3; c++) rgb[o + c] += buf[q + c] * a;
      }
  }
}

/** A frame of DMX (the rig's channels), each LED's colour at its address in the rig's order, scaled, gamma-bent,
 * rounded to 0..255. */
export function toChannels(scene, rgb, out, opts) {
  if (out && !ArrayBuffer.isView(out) && opts === undefined) { opts = out; out = undefined; }
  const gamma = opts && isNum(opts.gamma) && opts.gamma > 0 ? opts.gamma : 1;
  const brightness = opts && isNum(opts.brightness) ? Math.max(0, opts.brightness) : 1;
  const size = scene.frameChannels;
  const ch = out && out.length >= size ? out : new Uint8Array(size);
  ch.fill(0, 0, size);
  const addr = scene.addr, N = scene.count, order = scene.order;
  for (let k = 0; k < N; k++) {
    const base = addr[k];
    if (base < 0 || base + 2 >= size) continue;
    for (let c = 0; c < 3; c++) {
      let v = rgb[3 * k + c] * brightness;
      v = v > 0 ? (v < 1 ? v : 1) : 0;
      if (gamma !== 1) v = Math.pow(v, gamma);
      ch[base + order[c]] = Math.round(v * 255);
    }
  }
  return ch;
}
