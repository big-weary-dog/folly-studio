// Layers (SPEC "Modules"): each a module chain run over its pixels in one pass (each module works on what is above
// it: sources draw and combine, filters rework the colour, warps bend the pixel, warps.ts), or in stages round its
// spatial modules (SPEC "Spatial modules"); blended into a frame (output.ts), graded by the look's globals.
import type { Module } from '../../../shared/schemas/look.ts';
import { type Compiled, compileModule, describeError } from './compile.ts';
import { applyMods, finish, lookFrame, paramMods, prepareLook, resolveParams } from './globals.ts';
import type { G, PreparedLook, Values } from './globals.ts';
import { composite } from './output.ts';
import type { Picks } from './picks.ts';
import { pixelsForGroups, type Scene, tagMask } from './scene.ts';
import { blur, BLUR_MODES, blurState } from './spatial.ts';
import { clamp, hex, isNum, RUN, TAU } from './stdlib.ts';
import { layerEnvelope, normalizeClips } from './timeline.ts';
import { PLACE, readsLed, settle } from './place.ts';
import { copyPixel, isStageEnd, placeWarps } from './warps.ts';

export const MODULE_KINDS = Object.freeze(['source', 'warp', 'filter'] as const);
export type ModuleKind = (typeof MODULE_KINDS)[number];
export const BLENDS = Object.freeze(['add', 'over', 'max', 'multiply'] as const);
export type Blend = (typeof BLENDS)[number];
/** How a source combines into its chain: a layer's blends, and `under` (beneath what is above it). */
export const SOURCE_BLENDS = Object.freeze([...BLENDS, 'under'] as const);
export type SourceBlend = (typeof SOURCE_BLENDS)[number];
const SOURCE = 0, WARP = 1, FILTER = 2, SPATIAL = 3;      // SPATIAL: a filter the core runs over the layer at once
const OVER = 0, ADD = 1, MAX = 2, MULTIPLY = 3, UNDER = 4;
const BLEND = { over: OVER, add: ADD, max: MAX, multiply: MULTIPLY, under: UNDER };
const isBlend = (b: unknown): b is Blend => BLENDS.includes(b as Blend);
const isSourceBlend = (b: unknown): b is SourceBlend => SOURCE_BLENDS.includes(b as SourceBlend);

/** A layer as the core takes one (SPEC "Looks"), any field missing; code and params: a one-source chain. */
export type LayerInput = Partial<{ id: string, title: string, code: string, params: Record<string, unknown>,
  modules: Partial<Module>[], groups: string[], tags: string[], blend: string, level: number, clips: unknown,
  enabled: boolean, soften: unknown }>;

/** A layer's modules, or its own code and params as one source (looks before chains). */
export function layerModules(layer?: LayerInput | null): Partial<Module>[] {
  if (layer && Array.isArray(layer.modules)) return layer.modules.filter((m) => m && typeof m === 'object');
  return [{ id: 'm1', kind: 'source', title: layer?.title || 'Pattern', code: layer?.code,
    params: layer?.params as Module['params'] }];
}

const isOn = (m: Partial<Module>) => m.enabled !== false;

/** Each module compiled (null where disabled). Throws on the first failure, as "<module title>: …" in a chain. */
export function compileLayer(layer?: LayerInput | null) {
  const modular = Array.isArray(layer?.modules);
  return layerModules(layer).map((m) => {
    if (!isOn(m)) return null;
    try {
      return compileModule(m.code, m.kind ?? 'source');
    } catch (e) {
      if (!modular) throw e;
      throw new Error(`${m.title || m.id || 'Module'}: ${(e as Error)?.message || e}`, { cause: e });
    }
  });
}

/** The runnable chain: enabled modules with their function, params, bindings, blend, input (index or −1), whether
 * it ends a stage, and the slots of the pixel it reads (placeWarps). */
type Fn = (...a: unknown[]) => unknown;
// keep: a source's colours for a filter in a later stage (SPEC "Spatial modules"); picks: its colours.
type Link = { id: string | null, title: string, kind: number, fn: Fn, frame: Compiled['frame'] | null, P: Values,
  mods: ReturnType<typeof paramMods>, picks: Picks | null, blend: number, hidden: boolean, input: number,
  out: number[], keep: Float64Array | null, end: boolean, ix: number, at: number, from: number, to: number,
  led: boolean };
function prepareChain(layer: LayerInput | null | undefined, compiled: Compiled | readonly (Compiled | null)[]) {
  const modules = layerModules(layer);
  const list = Array.isArray(compiled) ? compiled : [compiled];
  if (list.length !== modules.length) throw new Error('prepareLayer: compile every module (compileLayer)');
  const chain: Link[] = [], at = new Map<string | undefined, number>(), clips = normalizeClips(layer?.clips);
  let shown = 0;
  for (const [i, m] of modules.entries()) {
    if (!isOn(m)) continue;
    const c = list[i];
    let kind = MODULE_KINDS.indexOf(m.kind ?? 'source');
    const fn = (c && (kind === SOURCE ? c.pixel : kind === WARP ? c.warp : c.filter)) as Fn | undefined;
    if (!c || typeof fn !== 'function') throw new Error('prepareLayer: layer is not compiled');
    if (kind === FILTER && c.spatial) kind = SPATIAL;
    const hidden = kind === SOURCE && m.as === 'input';
    const blend = isSourceBlend(m.blend) ? BLEND[m.blend] : shown ? ADD : OVER;
    if (kind === SOURCE && !hidden) shown++;
    const input = kind === FILTER ? at.get(m.input) ?? -1 : -1;
    if (kind === SOURCE) at.set(m.id, chain.length);
    const P = resolveParams(c.params, m.params), mods = paramMods(c.params, m.params, c.picks?.rot);
    c.picks?.bind(c.params, m.params, P);
    c.clocks?.bind(P, mods, clips);
    chain.push({ id: m.id ?? null, title: m.title || m.id || '', kind, fn, frame: c.frame || null,
      P, mods, picks: c.picks || null, blend, hidden, input,
      out: [0.5, 0, 0, 0], keep: null, end: kind === SPATIAL || isStageEnd(m), ix: 0, at: 0, from: -1, to: -1,
      led: kind !== WARP || readsLed(m.code) });
  }
  return chain;
}

/**
 * A chain's stages (SPEC "Spatial modules"): `soften` as a last blur; a source a later stage's filter reads keeps its
 * colours; the stage buffer and the blur's state. Null for a chain that runs in one pass.
 */
function prepareStages(S: Scene, layer: LayerInput | null | undefined, chain: Link[], idx: Int32Array) {
  const s = layer?.soften as { radius?: unknown, mode?: unknown } | null | undefined;
  if (s && typeof s === 'object' && Number(s.radius) > 0) {
    const mode = BLUR_MODES.includes(s.mode as never) ? s.mode as string : 'wire';
    chain.push({ id: null, title: 'Soften', kind: SPATIAL, fn: (c) => c, frame: null, mods: [], picks: null,
      blend: OVER, P: { radius: Number(s.radius), mode, amount: 1 }, hidden: false, input: -1,
      out: [0, 0, 0, 0], keep: null, end: true, ix: chain.length, at: 0, from: -1, to: -1, led: false });
  }
  if (!chain.some((M) => M.kind === SPATIAL)) return null;
  const m = idx.length;
  chain.forEach((M, i) => {
    const src = M.kind === FILTER && M.input >= 0 ? chain[M.input] : null;
    if (src && !src.keep && chain.slice(M.input, i).some((x) => x.kind === SPATIAL)) src.keep = new Float64Array(4 * m);
  });
  return { buf: new Float64Array(4 * m), ...blurState(S, idx) };
}

/** v (number, '#hex', [r, g, b, a?], nothing) into out as [r, g, b, a], alpha default `da`. False on NaN. */
function toColour(v: unknown, out: number[], da: number) {
  let r, g, b, al;
  if (v === undefined || v === null) { r = g = b = al = 0; }
  else if (typeof v === 'number') { r = g = b = v; al = da; }
  else {
    const c = (typeof v === 'string' ? hex(v) : v) as ArrayLike<number>;
    r = +c[0]; g = +c[1]; b = +c[2];
    al = c.length > 3 && c[3] !== undefined ? +c[3] : da;
  }
  if (r !== r || g !== g || b !== b || al !== al) return false;
  out[0] = r; out[1] = g; out[2] = b; out[3] = al < 0 ? 0 : al > 1 ? 1 : al;
  return true;
}

/** o into c (straight alpha) by blend; onto nothing it is simply o. */
function blendInto(c: number[], o: number[], mode: number) {
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
  } else if (mode === UNDER) {
    const keep = a * (1 - ca), A = ca + keep;
    for (let i = 0; i < 3; i++) c[i] = (c[i] * ca + o[i] * keep) / A;
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

const said = (v: unknown) => (Array.isArray(v) ? `[${Array.from(v).slice(0, 4).join(', ')}]` : String(v));

/** Layer L's chain at pattern time T into L.buf (rgba) → null, or an error (its module in L.failed). */
function runChain(S: Scene, L: PreparedLayer, T: number, G: G) {
  const idx = L.idx, m = idx.length, buf = L.buf, q = L.p, chain = L.chain, n = chain.length, c = L.c;
  const qs = L.qs, warps = L.warps, nw = warps.length;
  let j = 0, M: PreparedLayer['chain'][number] | null = null;
  try {
    for (let i = 0; i < n; i++) { M = chain[i]; if (M.frame) M.frame(T, M.P, G); }
    for (; j < m; j++) {
      const k = idx[j];
      setPixel(S, L, q, j, k);
      for (let w = 0; w < nw; w++) { M = warps[w]; bend(qs, M, T, G); }
      c[0] = c[1] = c[2] = c[3] = 0;
      for (let i = 0; i < n; i++) {
        M = chain[i];
        if (M.kind === WARP) continue;
        const q = qs[M.at];
        if (q.due) settle(q);
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

function fail(L: PreparedLayer, M: PreparedLayer['chain'][number] | null, msg: string) {
  L.failed = M ? M.id : null;
  return L.modular && M ? `${M.title}: ${msg}` : msg;
}

/** q as pixel j of layer L (rig pixel k). */
function setPixel(S: Scene, L: PreparedLayer, q: Pixel, j: number, k: number) {
  q.x = S.x[k]; q.y = S.y[k]; q.z = S.z[k];
  q.X = S.X[k]; q.Y = S.Y[k]; q.Z = S.Z[k];
  q.lx = L.lx[j]; q.ly = L.ly[j]; q.lz = L.lz[j];
  q.a = L.a[j]; q.r = L.r[j];
  q.u = S.u[k]; q.i = S.i[k]; q.n = S.n[k];
  const zi = S.zone[k];
  q.zi = zi; q.zone = S.zones[zi]; q.fixture = q.strand = S.fixture[k];
  q.ring = q.row = S.ring[k]; q.sector = q.petal = S.sector[k];
  q.k = k; q.seed = S.seed[k];
  const f = L.frame;
  q.ox = f[0]; q.oy = f[1]; q.oz = f[2]; q.sx = f[3]; q.sy = f[4]; q.sz = f[5]; q.sr = f[6];
  q.cy = f[7]; q.cz = f[8]; q.due = 0;
}

const load = (to: number[], from: Float64Array, o: number) => {
  to[0] = from[o]; to[1] = from[o + 1]; to[2] = from[o + 2]; to[3] = from[o + 3];
};
const save = (to: Float64Array, o: number, from: number[]) => {
  to[o] = from[0]; to[o + 1] = from[1]; to[o + 2] = from[2]; to[o + 3] = from[3];
};

/** A bending warp on pixel slots qs: a copy of its `from` slot unless it bends that in place. */
function bend(qs: Pixel[], W: Link, T: number, G: G) {
  if (W.to !== W.from) copyPixel(qs[W.to], qs[W.from]);
  const q = qs[W.to];
  if (W.led && q.due) settle(q);
  W.fn(q, T, W.P, G);
}

/**
 * A chain with spatial modules, stage by stage (SPEC "Spatial modules"): each stage's modules for every pixel into
 * the stage buffer (c unclamped, starting from the buffer after the first stage), then its spatial op over the buffer;
 * the last stage into L.buf as runChain does. A later stage reloads kept sources; its warps are its own.
 */
function runStaged(S: Scene, L: PreparedLayer, T: number, G: G, st: NonNullable<PreparedLayer['stages']>) {
  const idx = L.idx, m = idx.length, buf = L.buf, sb = st.buf, q = L.p, chain = L.chain, n = chain.length, c = L.c;
  const qs = L.qs, warps = L.warps, nw = warps.length;
  let from = 0, M: Link | null = null;
  try {
    for (let i = 0; i < n; i++) { M = chain[i]; if (M.frame) M.frame(T, M.P, G); }
    for (;;) {
      let to = from;
      while (to < n && chain[to].kind !== SPATIAL) to++;
      for (let j = 0; j < m; j++) {
        const k = idx[j], o = 4 * j;
        if (from) load(c, sb, o); else c[0] = c[1] = c[2] = c[3] = 0;
        if (from < to) {
          setPixel(S, L, q, j, k);
          for (let w = 0; w < nw; w++) { M = warps[w]; if (M.ix >= from && M.ix < to) bend(qs, M, T, G); }
          for (let i = 0; i < from; i++) { M = chain[i]; if (M.keep) load(M.out, M.keep, o); }
          for (let i = from; i < to; i++) {
            M = chain[i];
            if (M.kind === WARP) continue;
            const q = qs[M.at];
            if (q.due) settle(q);
            if (M.kind === SOURCE) {
              const v = M.fn(q, T, M.P, G);
              if (!toColour(v, M.out, 1)) return fail(L, M, `pixel() returned ${said(v)} (NaN) at LED ${k}`);
              if (M.keep) save(M.keep, o, M.out);
              if (!M.hidden) blendInto(c, M.out, M.blend);
            } else {
              const v = M.fn(c, q, T, M.P, G, M.input >= 0 ? chain[M.input].out : undefined);
              if (!toColour(v, c, c[3])) return fail(L, M, `filter() returned ${said(v)} (NaN) at LED ${k}`);
            }
          }
        }
        if (to < n) { save(sb, o, c); continue; }
        const r = c[0], g = c[1], b = c[2];
        buf[o] = r < 0 ? 0 : r > 1 ? 1 : r;
        buf[o + 1] = g < 0 ? 0 : g > 1 ? 1 : g;
        buf[o + 2] = b < 0 ? 0 : b > 1 ? 1 : b;
        buf[o + 3] = c[3];
      }
      if (to >= n) return null;
      M = chain[to];
      blur(S, idx, st, sb, M.P.radius, M.P.mode, M.P.amount);
      from = to + 1;
    }
  } catch (e) {
    return fail(L, M, describeError(e));
  }
}

/** The pixel a layer's chain sees (SPEC "The pixel p"), reused for every LED; `attr` and `is` read its k. */
function makePixel(S: Scene) {
  const q = { x: 0, y: 0, z: 0, X: 0, Y: 0, Z: 0, lx: 0, ly: 0, lz: 0, a: 0, r: 0, u: 0, i: 0, n: 1, zone: '', zi: 0,
    fixture: 0, strand: 0, ring: 0, row: 0, sector: -1, petal: -1, k: 0, seed: 0,
    ox: 0, oy: 0, oz: 0, sx: 0, sy: 0, sz: 0, sr: 0, cy: 0, cz: 0, due: 0,
    attr: (name: string, d = 0): number => { const v = S.attrs.get(name); return v ? v[q.k] : d; },
    is: (tag: string): boolean => tagMask(S, tag)[q.k] === 1 };
  return q;
}
/** The pixel `p` (SPEC "The pixel p"), as every module sees it. */
export type Pixel = ReturnType<typeof makePixel>;

/** A layer ready to render: its pixels, their lx/ly/lz (0.5 on a flat axis) and a/r, its chain and clips. */
export function prepareLayer(scene: Scene, layer: LayerInput | null | undefined,
  compiled: Compiled | readonly (Compiled | null)[]) {
  if (!compiled) throw new Error('prepareLayer: layer is not compiled');
  const chain = prepareChain(layer, compiled), bent = placeWarps(chain, WARP, SPATIAL);
  const idx = pixelsForGroups(scene, layer?.groups, layer?.tags);
  const m = idx.length;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, sy = 0, sz = 0;
  for (let j = 0; j < m; j++) {
    const k = idx[j];
    const X = scene.X[k], Y = scene.Y[k], Z = scene.Z[k];
    sy += Y; sz += Z;
    if (X < x0) x0 = X; if (X > x1) x1 = X;
    if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    if (Z < z0) z0 = Z; if (Z > z1) z1 = Z;
  }
  const norm = (v: number, lo: number, hi: number) => (hi - lo > 1e-6 ? (v - lo) / (hi - lo) : 0.5);
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
  const corner = (v: number[]) => Object.freeze(m ? v : [0, 0, 0]);
  const qs = Array.from({ length: bent.slots }, () => makePixel(scene));    // qs[0]: the pixel itself
  return {
    id: layer?.id ?? null,
    idx, lx, ly, lz, a, r,
    bounds: { min: [x0, y0, z0], max: [x1, y1, z1] },
    near: null as ((X: number, Y: number, Z: number) => number) | null,     // place.ts, on the first move
    frame: Float64Array.of((x0 + x1) / 2, cy, cz, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, rmax,
      m ? sy / m : 0, m ? sz / m : 0),                                   // then the middle of the LEDs
    extent: Object.freeze([corner([x0, y0, z0]), corner([x1, y1, z1])]),  // extent()
    chain, modular: Array.isArray(layer?.modules), failed: null as string | null,
    blend: isBlend(layer?.blend) ? layer.blend : 'add', level: isNum(layer?.level) ? clamp(layer.level) : 1,
    clips: normalizeClips(layer?.clips), enabled: layer?.enabled !== false,
    p: qs[0], qs, warps: bent.order, c: [0.5, 0, 0, 0],
    buf: new Float64Array(m * 4), ms: 0, stages: prepareStages(scene, layer, chain, idx),
  };
}

export type PreparedLayer = ReturnType<typeof prepareLayer>;
let plainLook: PreparedLook | null = null;
// Captured before any pattern code runs, so a pattern cannot fake its own timing.
const clock = globalThis.performance ? performance.now.bind(performance) : Date.now;

/**
 * Every prepared layer at show time t, bottom to top, into rgb (count × 3, 0..1), graded by `look` (prepareLook).
 * A failing layer adds nothing and is reported in `errors`; outside its clips it does not run. L.ms: its time.
 */
export function renderFrame(scene: Scene, layers: readonly (PreparedLayer | null)[] | null | undefined, t: number,
  out?: Float32Array | null, look?: PreparedLook | null) {
  const N = scene.count;
  const rgb = out && out.length >= N * 3 ? out : new Float32Array(N * 3);
  rgb.fill(0, 0, N * 3);
  const errors: { id: string | null, module?: string | null, error: string }[] = [];
  const list = layers || [];
  const LK = look || (plainLook ||= prepareLook(null));
  lookFrame(LK, t);
  RUN.scene = PLACE.scene = scene;
  const T = look ? LK.T : t, G = LK.G;
  for (let n = 0; n < list.length; n++) {
    const L = list[n];
    if (!L || !L.chain) continue;
    L.ms = 0;
    const env = L.clips ? layerEnvelope(L.clips, t) : 1, level = L.enabled ? L.level * env : 0;
    if (!(level > 0)) continue;
    const t0 = clock();
    RUN.extent = L.extent; PLACE.layer = L;
    for (let i = 0; i < L.chain.length; i++) {
      const M = L.chain[i];
      if (M.mods.length) applyMods(M.mods, M.P, t, env, LK);
      if (M.picks) M.picks.frame();
    }
    const err = L.stages ? runStaged(scene, L, T, G, L.stages) : runChain(scene, L, T, G);
    if (err) errors.push(L.modular ? { id: L.id, module: L.failed, error: err } : { id: L.id, error: err });
    else composite(rgb, L, level);
    L.ms = clock() - t0;
  }
  finish(rgb, N * 3, LK);
  return { rgb, errors };
}
