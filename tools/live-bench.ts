#!/usr/bin/env node
// The Pi engine's frame loop, headless: every library look (tools/bench-looks.ts) played as the engine plays it
// (pi/src/engine.ts: live controls, renderFrame, the flash guard, ledChannels, the rose and the power compressor),
// timed by stage. Our own library code only.
//
//   node tools/live-bench.ts [--rig rig.json|rig-folly.json] [--frames 400] [--only name,name] [--ablate]
//     [--json file] [--no-soften]
//
// Per look: ms a frame (mean, p95, max) of the whole tick; render, flash guard, ledChannels, rose + power; the
// composite (blend) inside render; heap allocated a frame (KB, over frames without a GC), a hash of every LED byte
// sent (bytes#: equal before and after a change means the output is unchanged) and GCs. --ablate: each module's
// share, as the render's mean less the render with that module's function a constant.
import { readFileSync, writeFileSync } from 'node:fs';
import { PerformanceObserver, performance } from 'node:perf_hooks';
import v8 from 'node:v8';

import { FlashGuard } from '../public/js/flash-guard.ts';
import { lightOf } from '../public/js/core/light.ts';
import { composite } from '../public/js/core/output.ts';
import { compileLayer, ledChannels, prepareLayer, prepareLight, prepareScene, renderFrame, setLibrary }
  from '../public/js/pattern-core.ts';
import type { PreparedLayer } from '../public/js/pattern-core.ts';
import { liveLook } from '../pi/src/controls.ts';
import { type PiLook, resolveLook } from '../pi/src/library.ts';
import { expandRose, powerLimiter, type PowerTable } from '../pi/src/power.ts';
import { lib, libraryLooks } from './bench-looks.ts';

const argv = process.argv, has = (name: string) => argv.includes(name);
const arg = (name: string, d: string) => { const i = argv.indexOf(name); return i > 0 ? argv[i + 1]! : d; };
const RIG = arg('--rig', 'rig.json'), FRAMES = Number(arg('--frames', '400')), ONLY = arg('--only', '');
const ABLATE = has('--ablate'), JSON_OUT = arg('--json', '');
const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const rig = read(`../public/data/${RIG}`);
const table: PowerTable | null = RIG === 'rig.json' ? read('../pi/data/power.json') : null;
setLibrary([...lib.entries.values()]);

const scene = prepareScene(rig), fps = scene.fps, dt = 1 / fps;
const L0 = lightOf(null), light = prepareLight(scene, L0);
const rgb = new Float32Array(scene.count * 3), cells = new Uint8Array(scene.frameChannels);
const expanded = table ? new Uint8Array(table.channels) : null;
const scratch = new Float32Array(scene.count * 3);

let gcs = 0, gcMs = 0;
new PerformanceObserver((list) => { for (const e of list.getEntries()) { gcs++; gcMs += e.duration; } })
  .observe({ entryTypes: ['gc'] });
const heap = () => v8.getHeapStatistics().used_heap_size;
const stats = (a: Float64Array) => {
  const s = [...a].sort((x, y) => x - y), mean = s.reduce((x, y) => x + y, 0) / s.length;
  return { mean, p95: s[Math.floor(s.length * 0.95)]!, max: s[s.length - 1]! };
};

type Prepared = { live: ReturnType<typeof liveLook>, layers: PreparedLayer[], duration: number };
function prepare(look: PiLook): Prepared {
  const r = resolveLook(look, lib);
  return { live: liveLook(r), layers: r.layers.map((l) => prepareLayer(scene, l, compileLayer(l))),
    duration: r.duration || 30 };
}

/** Plays `frames` frames from frame 0; times by stage. */
function play(P: Prepared, frames: number, renderOnly = false) {
  const guard = new FlashGuard(rig, null, L0), limiter = table ? powerLimiter(table) : null;
  const tick = new Float64Array(frames), render = new Float64Array(frames), flash = new Float64Array(frames);
  const out = new Float64Array(frames), power = new Float64Array(frames);
  let alloc = 0, quiet = 0, errors = 0, lastErr = '', sum = 0;
  for (let f = 0; f < frames; f++) {
    const t = (f * dt) % P.duration, h0 = heap();
    const a = performance.now();
    P.live.step(t, dt);
    const r = renderFrame(scene, P.layers, t, rgb, P.live.look);
    const b = performance.now();
    if (r.errors.length) { errors++; lastErr = r.errors[0]!.error; }
    if (!renderOnly) {
      guard.observe(rgb, f * 1000 / fps, 1);
      const c = performance.now();
      ledChannels(scene, rgb, light, cells, 1);
      const d = performance.now();
      if (table) { expandRose(table, cells, expanded!); limiter!.apply(expanded!); }
      const e = performance.now();
      flash[f] = c - b; out[f] = d - c; power[f] = e - d;
    }
    const z = performance.now(), h1 = heap();
    if (!renderOnly) for (let i = 0; i < cells.length; i++) sum = (Math.imul(sum, 31) + cells[i]!) | 0;
    render[f] = b - a; tick[f] = z - a;
    if (h1 >= h0) { alloc += h1 - h0; quiet++; }
  }
  // The blend alone: each layer composited again onto the last frame (renderFrame's composite, at full level).
  let blend = 0;
  for (let i = 0; i < 20; i++) {
    scratch.set(rgb);
    const c0 = performance.now();
    for (const L of P.layers) composite(scratch, L, 1);
    blend += (performance.now() - c0) / 20;
  }
  return { tick: stats(tick), render: stats(render), flash: stats(flash).mean, out: stats(out).mean,
    power: stats(power).mean, blend, allocKB: quiet ? alloc / quiet / 1024 : NaN, errors, lastErr,
    sum: (sum >>> 0).toString(16) };
}

/** Each module's share of the render: the render less the render with its function a constant. */
function ablate(look: PiLook, base: number) {
  const shares: string[] = [];
  const r = resolveLook(look, lib);
  r.layers.forEach((layer, li) => layer.modules!.forEach((m, mi) => {
    const P = prepare(look), L = P.layers[li]!, M = L.chain.find((x) => x.id === (m.id ?? `m${mi + 1}`));
    if (!M) return;
    const kind = M.kind, white = [0.5, 0.5, 0.5, 1];
    M.fn = kind === 0 ? () => white : kind === 1 ? () => {} : ((c: unknown) => c) as never;
    play(P, 40, true);
    const t = play(P, Math.min(FRAMES, 200), true).render.mean;
    shares.push(`${m.ref}:${(base - t).toFixed(2)}`);
  }));
  return shares.join(' ');
}

const pad = (v: unknown, n = 7) => String(v).padStart(n);
const f2 = (v: number) => v.toFixed(2);
console.log(`${rig.name}: ${scene.count} px, ${fps} fps, ${FRAMES} frames a look${table ? ', rose + power' : ''}`);
console.log(['look'.padEnd(40), 'tick', 'p95', 'max', 'render', 'blend', 'flash', 'ledCh', 'power', 'KB/f', 'bytes#']
  .map((c, i) => (i ? pad(c) : c)).join(' '));
const rows: Record<string, unknown>[] = [];
const gc0 = { n: gcs, ms: gcMs };
const chosen = libraryLooks(has('--no-soften')).filter((l) => !ONLY || ONLY.split(',').some((o) => l.id.includes(o)));
for (const look of chosen) {
  let P: Prepared;
  try { P = prepare(look); } catch (e) { console.log(`${look.id}: cannot play: ${(e as Error).message}`); continue; }
  play(P, 80);                         // warm: the JIT, near grids, history rings
  P = prepare(look);
  const g0 = gcs, gm0 = gcMs;
  const s = play(P, FRAMES);
  await new Promise((r) => setImmediate(r));
  const row = { id: look.id, layers: P.layers.length, ...s, gcs: gcs - g0, gcMs: gcMs - gm0 };
  rows.push(row);
  console.log([look.id.padEnd(40), f2(s.tick.mean), f2(s.tick.p95), f2(s.tick.max), f2(s.render.mean), f2(s.blend),
    f2(s.flash), f2(s.out), f2(s.power), s.allocKB.toFixed(0), s.sum.padStart(8)].map((c, i) => (i ? pad(c) : c))
    .join(' ') + (s.errors ? `  ERR ${s.errors}: ${s.lastErr}` : '')
    + (row.gcs ? `  gc ${row.gcs} ${f2(row.gcMs)}ms` : ''));
  if (ABLATE) console.log(`  modules (ms): ${ablate(look, s.render.mean)}`);
}
const tot = rows.reduce((a, r) => a + (r.tick as { mean: number }).mean, 0) / rows.length;
console.log(`mean tick over ${rows.length} looks: ${f2(tot)} ms; GCs ${gcs - gc0.n}, ${f2(gcMs - gc0.ms)} ms`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1));
