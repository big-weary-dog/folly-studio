// Layers (SPEC "Modules"): each a module chain run over its pixels in one pass (each module works on what is above
// it: sources draw and combine, filters rework the colour, warps bend the pixel, warps.ts), or in stages round its
// spatial modules (SPEC "Spatial modules"); blended into a frame (output.ts), graded by the look's globals.
import type { Module } from '../../../shared/schemas/look.ts';
import { compileModule, describeError } from './compile.ts';
import { applyMods, finish, lookFrame, prepareLook } from './globals.ts';
import type { G, PreparedLook } from './globals.ts';
import { composite } from './output.ts';
import { pixelsForGroups, type Scene } from './scene.ts';
import { sortStrands } from './sort.ts';
import { blur, BLUR_MODES, blurState } from './spatial.ts';
import { clamp, isNum, RUN, TAU } from './stdlib.ts';
import { clipAt, clipFade, layerEnvelope, normalizeClips, type Transition, wipeColours } from './timeline.ts';
import { nearFor, PLACE } from './place.ts';
import { makePixel, type Pixel, setPixel } from './pixel.ts';
import { placeWarps } from './warps.ts';
import { BLENDS, type Blend, type CompiledLink, FILTER, isOn, type Link, OVER, prepareChain, SPATIAL, type Sub,
  subsPlace, WARP } from './chain.ts';
import { bend, pass, PASS } from './pass.ts';
export type { Pixel };
export { BLENDS, CHAIN_KINDS, MODULE_KINDS, SOURCE_BLENDS } from './chain.ts';
export type { Blend, ModuleKind, SourceBlend } from './chain.ts';
const isBlend = (b: unknown): b is Blend => BLENDS.includes(b as Blend);

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


/** Each module compiled (null where disabled), a composite's sub-layers too. Throws on the first failure, as
 * "<module title>: …" in a chain. */
export function compileLayer(layer?: LayerInput | null): (CompiledLink | null)[] {
  const modular = Array.isArray(layer?.modules);
  return layerModules(layer).map((m) => {
    if (!isOn(m)) return null;
    if (m.kind === 'composite') {
      return { kind: 'composite', subs: (m.layers ?? []).map((s) => compileLayer({ modules: s.modules })) };
    }
    try {
      return compileModule(m.code, m.kind ?? 'source');
    } catch (e) {
      if (!modular) throw e;
      throw new Error(`${m.title || m.id || 'Module'}: ${(e as Error)?.message || e}`, { cause: e });
    }
  });
}

/** A chain's stages (SPEC "Spatial modules"): `soften` as a last blur, then stagesOf. */
function prepareStages(S: Scene, layer: LayerInput | null | undefined, chain: Link[], idx: Int32Array) {
  const s = layer?.soften as { radius?: unknown, mode?: unknown } | null | undefined;
  if (s && typeof s === 'object' && Number(s.radius) > 0) {
    const mode = BLUR_MODES.includes(s.mode as never) ? s.mode as string : 'wire';
    chain.push({ id: null, title: 'Soften', kind: SPATIAL, fn: (c) => c, frame: null, mods: [], picks: null,
      blend: OVER, P: { radius: Number(s.radius), mode, amount: 1 }, hidden: false, input: -1, src: null,
      fixed: false, out: [0, 0, 0, 0], keep: null, end: true, ix: chain.length, at: 0, from: -1, to: -1, led: false,
      bright: false, ring: null, op: 'blur', subs: null });
  }
  return stagesOf(S, chain, idx);
}

/** A source a later stage's filter reads keeps its colours (an attached run's filters read the chain round it); the
 * stage buffer and the blur's state. Null for a chain that runs in one pass. */
function stagesOf(S: Scene, chain: Link[], idx: Int32Array) {
  if (!chain.some((M) => M.kind === SPATIAL)) return null;
  const m = idx.length;
  chain.forEach((M, i) => {
    for (const F of M.subs?.[0].attach ? M.subs[0].chain : [M]) {
      const at = F.kind === FILTER && F.src ? chain.indexOf(F.src) : -1, src = chain[at];
      if (at < 0 || src.keep || !chain.slice(at, i).some((x) => x.kind === SPATIAL)) continue;
      src.keep = new Float64Array(4 * m);
    }
  });
  return { buf: new Float64Array(4 * m), ...blurState(S, idx) };
}
export type Stages = ReturnType<typeof stagesOf>;

/** Each attached run that holds a spatial module, to run over the layer before its chain, with its buffers. */
function prepareRuns(S: Scene, chain: Link[], idx: Int32Array) {
  const runs: Sub[] = [];
  for (const M of chain) {
    const sub = M.subs?.[0];
    if (!sub?.attach || !sub.chain.some((x) => x.kind === SPATIAL)) continue;
    const reads = sub.chain.find((F) => F.src && !sub.chain.includes(F.src));
    if (reads) throw new Error(`${reads.title}: on ${M.title}, which a spatial module runs over first, it reads no `
      + 'input');
    sub.pre = new Float64Array(4 * idx.length);
    sub.stages = stagesOf(S, sub.chain, idx);
    runs.push(sub);
  }
  return runs;
}

function fail(L: PreparedLayer, M: Link | null, msg: string) {
  L.failed = M ? M.id : null;
  return L.modular && M ? `${M.title}: ${msg}` : msg;
}

const load = (to: number[], from: Float64Array, o: number) => {
  to[0] = from[o]; to[1] = from[o + 1]; to[2] = from[o + 2]; to[3] = from[o + 3];
};
const save = (to: Float64Array, o: number, from: number[]) => {
  to[o] = from[0]; to[o + 1] = from[1]; to[o + 2] = from[2]; to[o + 3] = from[3];
};

/** What runStages runs: a layer's chain, or an attached run's. */
type Run = { chain: Link[], warps: Link[], qs: Pixel[], c: number[], stages: Stages | null };

/** Layer L's frames, its attached runs that a spatial module reads (each into its pre), then its chain into L.buf
 * at pattern time T → null, or an error (its module in L.failed). */
function runChain(S: Scene, L: PreparedLayer, T: number, G: G) {
  let M: Link | null = null;
  PASS.at = null;
  try {
    RUN.dt = 0;
    for (const A of L.all) { M = A; A.ring?.advance(T, L.idx.length); if (A.frame) A.frame(T, A.P, G); }
    for (const R of L.runs) { const e = runStages(S, L, R, R.pre!, T, G, false); if (e) return fail(L, PASS.at, e); }
    const e = runStages(S, L, L, L.buf, T, G, true);
    return e ? fail(L, PASS.at, e) : null;
  } catch (e) {
    return fail(L, PASS.at ?? M, describeError(e));
  }
}

/**
 * R's chain at layer L's pixels into out (rgba; clamped for the layer) → null, or an error (its link in PASS.at).
 * Stage by stage (SPEC "Spatial modules"), one stage without spatial modules: each stage's modules for every pixel
 * into the stage buffer (c unclamped, starting from the buffer after the first stage), then its spatial op over the
 * buffer; the last stage into out. A later stage reloads kept sources; its warps are its own.
 */
function runStages(S: Scene, L: PreparedLayer, R: Run, out: Float64Array, T: number, G: G, clamped: boolean) {
  const st = R.stages, idx = L.idx, m = idx.length, sb = st?.buf, q = R.qs[0], chain = R.chain;
  const n = chain.length, c = R.c;
  const qs = R.qs, warps = R.warps, nw = warps.length;
  let from = 0;
  for (;;) {
    let to = from;
    while (to < n && chain[to].kind !== SPATIAL) to++;
    for (let j = 0; j < m; j++) {
      const k = idx[j], o = 4 * j;
      if (from) load(c, sb!, o); else c[0] = c[1] = c[2] = c[3] = 0;
      if (from < to) {
        setPixel(S, L, q, j, k);
        for (let w = 0; w < nw; w++) { const W = warps[w]; if (W.ix >= from && W.ix < to) bend(qs, W, T, G); }
        for (let i = 0; i < from; i++) { const K = chain[i]; if (K.keep) load(K.out, K.keep, o); }
        const e = pass(chain, from, to, qs, c, T, G, j, k);
        if (e) return e;
      }
      if (to < n) { save(sb!, o, c); continue; }
      if (!clamped) { save(out, o, c); continue; }
      const r = c[0], g = c[1], b = c[2];
      out[o] = r < 0 ? 0 : r > 1 ? 1 : r;
      out[o + 1] = g < 0 ? 0 : g > 1 ? 1 : g;
      out[o + 2] = b < 0 ? 0 : b > 1 ? 1 : b;
      out[o + 3] = c[3];
    }
    if (to >= n) return null;
    const M = chain[to];
    PASS.at = M;
    if (M.op === 'sort') sortStrands(S, idx, sb!, M.P.by, M.P.direction, M.P.cutoff, M.P.amount);
    else blur(S, idx, st!, sb!, M.P.radius, M.P.mode, M.P.amount);
    from = to + 1;
  }
}

/** A layer ready to render: its pixels, their lx/ly/lz (0.5 on a flat axis) and a/r, its chain and clips. */
export function prepareLayer(scene: Scene, layer: LayerInput | null | undefined,
  compiled: CompiledLink | readonly (CompiledLink | null)[]) {
  if (!compiled) throw new Error('prepareLayer: layer is not compiled');
  const clips = normalizeClips(layer?.clips), all: Link[] = [];
  const chain = prepareChain(layerModules(layer), Array.isArray(compiled) ? compiled : [compiled],
    { scene, clips, all, depth: 0 });
  const bent = placeWarps(chain, WARP, SPATIAL);
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
  const corner = (v: number[]) => Object.freeze(m ? v : [0, 0, 0]), bounds = { min: [x0, y0, z0], max: [x1, y1, z1] };
  const qs = Array.from({ length: bent.slots }, () => makePixel(scene));    // qs[0]: the pixel itself
  return {
    id: layer?.id ?? null,
    idx, lx, ly, lz, a, r,
    bounds,
    near: (bent.order.length || subsPlace(all)) && m ? nearFor(scene, { idx, bounds }) : null,
    frame: Float64Array.of((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2,
      rmax, cy, cz),                                                     // then a r's centre: the middle of the LEDs
    extent: Object.freeze([corner([x0, y0, z0]), corner([x1, y1, z1])]),  // extent()
    chain, all, modular: Array.isArray(layer?.modules), failed: null as string | null,
    blend: isBlend(layer?.blend) ? layer.blend : 'add', level: isNum(layer?.level) ? clamp(layer.level) : 1,
    clips: normalizeClips(layer?.clips), enabled: layer?.enabled !== false,
    p: qs[0], qs, warps: bent.order, c: [0.5, 0, 0, 0],
    buf: new Float64Array(m * 4), ms: 0, stages: prepareStages(scene, layer, chain, idx),
    runs: prepareRuns(scene, chain, idx),
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
    for (let i = 0; i < L.all.length; i++) {
      const M = L.all[i];
      if (M.mods.length) applyMods(M.mods, M.P, t, env, LK);
      if (M.picks) M.picks.frame();
    }
    const err = runChain(scene, L, T, G);
    if (err) errors.push(L.modular ? { id: L.id, module: L.failed, error: err } : { id: L.id, error: err });
    else {
      if (wipe) wipeColours(L.buf, L, scene, wipe as Transition, env, clipFade(clip!, t) < 0);
      composite(rgb, L, level);
    }
    L.ms = clock() - t0;
  }
  finish(rgb, N * 3);
  return { rgb, errors };
}
