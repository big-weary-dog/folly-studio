// A layer's module chain (SPEC "Modules"): which modules it has, compiling them, and running them over the
// layer's pixels in one pass: warps move the pixel, sources draw and combine, filters rework the colour.
import { compileModule, describeError } from './compile.js';
import { paramMods, resolveParams } from './modulate.js';
import { hex } from './stdlib.js';

export const MODULE_KINDS = Object.freeze(['source', 'warp', 'filter']);
const SOURCE = 0, WARP = 1, FILTER = 2;
const OVER = 0, ADD = 1, MAX = 2, MULTIPLY = 3;
const BLEND = { over: OVER, add: ADD, max: MAX, multiply: MULTIPLY };

/** A layer's modules: `layer.modules`, or a layer's own code and params as one source (looks before chains). */
export function layerModules(layer) {
  if (layer && Array.isArray(layer.modules)) return layer.modules.filter((m) => m && typeof m === 'object');
  return [{ id: 'm1', kind: 'source', title: (layer && layer.title) || 'Pattern', code: layer && layer.code,
    params: layer && layer.params }];
}

const isOn = (m) => m.enabled !== false;

/**
 * Each module of a layer compiled (null where disabled). Throws on the first failure: as compilePattern does for a
 * layer with code, as "<module title>: <message>" for a chain.
 */
export function compileLayer(layer) {
  const modular = !!(layer && Array.isArray(layer.modules));
  return layerModules(layer).map((m) => {
    if (!isOn(m)) return null;
    try {
      return compileModule(m.code, m.kind ?? 'source');
    } catch (e) {
      if (!modular) throw e;
      throw new Error(`${m.title || m.id || 'Module'}: ${e && e.message ? e.message : e}`);
    }
  });
}

/**
 * The runnable chain: enabled modules with their function, params (P, and bindings for applyMods), blend, a
 * filter's input (index of an earlier source, else −1) and an output buffer. Throws if a module is not compiled.
 */
export function prepareChain(layer, compiled) {
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

/** v (number, '#hex', [r, g, b, a?], nothing) into out as [r, g, b, a]; alpha defaults to `da`. False on NaN. */
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

/**
 * Runs layer L's chain over its pixels at pattern time T into L.buf (rgba). Returns null, or an error string with
 * the module to blame in L.failed. No allocation unless something fails.
 */
export function runChain(S, L, T, G) {
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
      q.zi = zi; q.zone = zones[zi]; q.strand = S.strand[k];
      q.row = S.row[k]; q.petal = S.petal[k];
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
