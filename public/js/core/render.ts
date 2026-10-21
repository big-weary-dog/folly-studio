// Layers (SPEC "Modules"): each a module chain run over its pixels in one pass (each module works on what is above
// it: sources draw and combine, filters rework the colour, warps bend the pixel, warps.ts), or in stages round its
// spatial modules (SPEC "Spatial modules"); blended into a frame (output.ts), graded by the look's globals.
import type { Module } from '../../../shared/schemas/look.ts';
import { type Compiled, compileModule, describeError, upgradeParams } from './compile.ts';
import { applyMods, finish, lookFrame, paramMods, prepareLook, resolveParams } from './globals.ts';
import type { G, PreparedLook, Values } from './globals.ts';
import { composite } from './output.ts';
import type { Picks } from './picks.ts';
import { pixelsForGroups, type Scene } from './scene.ts';
import { sortStrands } from './sort.ts';
import { blur, BLUR_MODES, blurState } from './spatial.ts';
import { clamp, hex, isNum, RUN, TAU } from './stdlib.ts';
import { clipAt, layerEnvelope, normalizeClips, type Transition, wipeColours } from './timeline.ts';
import { PLACE, readsLed, settle } from './place.ts';
import { copyPixel, makePixel, type Pixel, setPixel } from './pixel.ts';
import { isStageEnd, placeWarps } from './warps.ts';
import { addLight } from './light.ts';
export type { Pixel };

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
// keep: a source's colours for a filter in a later stage (SPEC "Spatial modules"); op: a spatial one's; picks: its
// colours; ring: the frames above it (SPEC "History").
type Link = { id: string | null, title: string, kind: number, fn: Fn, frame: Compiled['frame'] | null, P: Values,
  mods: ReturnType<typeof paramMods>, picks: Picks | null, blend: number, hidden: boolean, input: number,
  out: number[], keep: Float64Array | null, end: boolean, ix: number, at: number, from: number, to: number,
  led: boolean, bright: boolean, ring: Compiled['history'] | null, op: Compiled['spatial'] | null };
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
    const saved = upgradeParams(c, m.params) as Module['params'];
    const P = resolveParams(c.params, saved), mods = paramMods(c.params, saved, c.picks?.rot);
    c.picks?.bind(c.params, saved, P);
    c.clocks?.bind(P, mods, clips);
    chain.push({ id: m.id ?? null, title: m.title || m.id || '', kind, fn, frame: c.frame || null,
      P, mods, picks: c.picks || null, blend, hidden, input,
      out: [0.5, 0, 0, 0], keep: null, end: kind === SPATIAL || isStageEnd(m), ix: 0, at: 0, from: -1, to: -1,
      led: readsLed(m.code), bright: kind === SOURCE && !!c.bright, ring: c.history ?? null,
      op: c.spatial ?? null });
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
      out: [0, 0, 0, 0], keep: null, end: true, ix: chain.length, at: 0, from: -1, to: -1, led: false, bright: false,
      ring: null, op: 'blur' });
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

/** o into c (straight alpha) by blend, alpha scaling values and add summing their light; onto nothing it is o. */
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
    for (let i = 0; i < 3; i++) c[i] = addLight(c[i] * ca, o[i] * a) / A;
    c[3] = A;
  } else {
    const A = a > ca ? a : ca;
    for (let i = 0; i < 3; i++) { const x = c[i] * ca, y = o[i] * a; c[i] = (x > y ? x : y) / A; }
    c[3] = A;
  }
}

/** A source's colour times its Brightness (SPEC "Pattern code"), alpha kept. */
const dim = (o: number[], b: number) => { o[0] *= b; o[1] *= b; o[2] *= b; };

const said = (v: unknown) => (Array.isArray(v) ? `[${Array.from(v).slice(0, 4).join(', ')}]` : String(v));

function fail(L: PreparedLayer, M: PreparedLayer['chain'][number] | null, msg: string) {
  L.failed = M ? M.id : null;
  return L.modular && M ? `${M.title}: ${msg}` : msg;
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
  RUN.dt = q.dt;
  W.fn(q, T + q.dt, W.P, G);
}

/**
 * Layer L's chain at pattern time T into L.buf (rgba) → null, or an error (its module in L.failed). Stage by stage
 * (SPEC "Spatial modules"), one stage without spatial modules: each stage's modules for every pixel into the stage
 * buffer (c unclamped, starting from the buffer after the first stage), then its spatial op over the buffer; the last
 * stage into L.buf, clamped. A later stage reloads kept sources; its warps are its own.
 */
function runChain(S: Scene, L: PreparedLayer, T: number, G: G) {
  const st = L.stages, idx = L.idx, m = idx.length, buf = L.buf, sb = st?.buf, q = L.p, chain = L.chain;
  const n = chain.length, c = L.c;
  const qs = L.qs, warps = L.warps, nw = warps.length;
  let from = 0, M: Link | null = null;
  try {
    RUN.dt = 0;
    for (let i = 0; i < n; i++) { M = chain[i]; M.ring?.advance(T, m); if (M.frame) M.frame(T, M.P, G); }
    for (;;) {
      let to = from;
      while (to < n && chain[to].kind !== SPATIAL) to++;
      for (let j = 0; j < m; j++) {
        const k = idx[j], o = 4 * j;
        if (from) load(c, sb!, o); else c[0] = c[1] = c[2] = c[3] = 0;
        if (from < to) {
          setPixel(S, L, q, j, k);
          for (let w = 0; w < nw; w++) { M = warps[w]; if (M.ix >= from && M.ix < to) bend(qs, M, T, G); }
          for (let i = 0; i < from; i++) { M = chain[i]; if (M.keep) load(M.out, M.keep, o); }
          for (let i = from; i < to; i++) {
            M = chain[i];
            if (M.kind === WARP) continue;
            const q = qs[M.at];
            if (q.due && M.led) settle(q);
            RUN.dt = q.dt;
            if (M.kind === SOURCE) {
              const v = M.fn(q, T + q.dt, M.P, G);
              if (!toColour(v, M.out, 1)) return fail(L, M, `pixel() returned ${said(v)} (NaN) at LED ${k}`);
              M.out[3] *= q.gate;
              if (M.bright) dim(M.out, M.P.brightness as number);
              if (M.keep) save(M.keep, o, M.out);
              if (!M.hidden) blendInto(c, M.out, M.blend);
            } else {
              M.ring?.record(j, c);
              const v = M.fn(c, q, T + q.dt, M.P, G, M.input >= 0 ? chain[M.input].out : undefined);
              if (!toColour(v, c, c[3])) return fail(L, M, `filter() returned ${said(v)} (NaN) at LED ${k}`);
            }
          }
        }
        if (to < n) { save(sb!, o, c); continue; }
        const r = c[0], g = c[1], b = c[2];
        buf[o] = r < 0 ? 0 : r > 1 ? 1 : r;
        buf[o + 1] = g < 0 ? 0 : g > 1 ? 1 : g;
        buf[o + 2] = b < 0 ? 0 : b > 1 ? 1 : b;
        buf[o + 3] = c[3];
      }
      if (to >= n) return null;
      M = chain[to];
      if (M.op === 'sort') sortStrands(S, idx, sb!, M.P.by, M.P.direction, M.P.cutoff, M.P.amount);
      else blur(S, idx, st!, sb!, M.P.radius, M.P.mode, M.P.amount);
      from = to + 1;
    }
  } catch (e) {
    return fail(L, M, describeError(e));
  }
}

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
  // a r turn round the LEDs' mean (on City of Gods the rose), not the bounds' middle 1.7 m above it.
  const cy = m ? sy / m : 0, cz = m ? sz / m : 0;
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
    frame: Float64Array.of((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2,
      rmax, cy, cz),                                                     // then a r's centre: the middle of the LEDs
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
    const env = L.clips ? layerEnvelope(L.clips, t) : 1, clip = env < 1 ? clipAt(L.clips, t) : null;
    const wipe = clip?.transition, level = L.enabled ? L.level * (wipe ? 1 : env) : 0;
    if (!(level > 0 && env > 0)) continue;
    const t0 = clock();
    RUN.extent = L.extent; PLACE.layer = L;
    for (let i = 0; i < L.chain.length; i++) {
      const M = L.chain[i];
      if (M.mods.length) applyMods(M.mods, M.P, t, env, LK);
      if (M.picks) M.picks.frame();
    }
    const err = runChain(scene, L, T, G);
    if (err) errors.push(L.modular ? { id: L.id, module: L.failed, error: err } : { id: L.id, error: err });
    else {
      if (wipe) wipeColours(L.buf, L, scene, wipe as Transition, env, t > (clip!.start + clip!.end) / 2);
      composite(rgb, L, level);
    }
    L.ms = clock() - t0;
  }
  finish(rgb, N * 3);
  return { rgb, errors };
}
