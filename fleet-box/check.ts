#!/usr/bin/env node
// Folly Studio look checker, for the boxed Fleet worker (not the server: it runs pattern code).
// Usage: node check.ts [look.json] [--bake [--seconds S]]
// Compiles every layer with the studio's pattern core, renders frames on the rig (rig.json) and prints
// problems; exit 1 if the look would be rejected or a layer fails. --bake then bakes it as the render box
// does (renderer.ts; its duration up to 120 s unless --seconds says) into frames.fseq and stats.json
// beside the look, and runs the studio's frame checks (frames.ts) on it: the studio repeats them; only those count.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import type * as Fseq from '../public/js/fseq.ts';
import type * as Core from '../public/js/pattern-core.ts';
import type * as Renderer from '../render-box/renderer.ts';
import type * as Frames from '../src/frames.ts';

const LIMITS = { layers: 4, codeBytes: 20 * 1024, title: 80, summary: 400, clips: 32, duration: 600, modules: 8 };
const FUNCTION: Record<string, string> = { source: 'pixel', warp: 'warp', filter: 'filter' };
const errors: string[] = [], warnings: string[] = [];
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const option = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--seconds') || 'look.json';
const BAKE = flag('--bake');
function fail(message: string): never { console.error(`✗ ${message}`); process.exit(1); }
const why = (e: unknown) => (e as Error).message;
let look: any; // the worker's look.json: untrusted JSON, checked field by field (its layers too)
try { look = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { fail(`${file}: ${why(e)}`); }
if (['pattern-core.ts', 'renderer.ts', 'rig.json'].some((f) => !existsSync(new URL(f, import.meta.url)))) {
  fail('pattern-core.ts, renderer.ts and rig.json must sit next to check.ts');
}
// The modules the host copied beside this file (src/generate/fleet.ts), typed as the studio's own.
const beside = (f: string) => new URL(f, import.meta.url).href;
const core: typeof Core = await import(beside('pattern-core.ts'));
const { bakeLoop, bakeSeconds, FPS, readLibrary, renderer }: typeof Renderer = await import(beside('renderer.ts'));
const BLENDS: readonly string[] = core.BLENDS;
// The library use() runs: patterns/ beside this file when the host copied it, else none.
const library = readLibrary(path.join(path.dirname(new URL(import.meta.url).pathname), 'patterns'));
core.setLibrary(library);
// A palette by name is filled in from palettes.json beside this file (as the studio does on save).
const named = typeof look.globals?.palette === 'string' ? look.globals.palette : null;
const palettes = existsSync(new URL('./palettes.json', import.meta.url))
  ? JSON.parse(readFileSync(new URL('./palettes.json', import.meta.url), 'utf8')).palettes : [];
const palette = named ? palettes.find((p: { name: string }) => p.name === named.toLowerCase()) : look.globals?.palette;
if (named && !palette) warnings.push(`palette ${named}: not known here, so the default palette plays`);
const { automation, bpm } = look;
const lookGlobals = { globals: look.globals && { ...look.globals, palette }, automation, bpm };
const goodDuration = Number.isFinite(look?.duration) && look.duration >= 1 && look.duration <= LIMITS.duration;
const DURATION = goodDuration ? look.duration : 30;
const SECONDS = bakeSeconds({ duration: DURATION }, option('--seconds'));
const rig = JSON.parse(readFileSync(new URL('./rig.json', import.meta.url), 'utf8'));
const groupIds = new Set((rig.groups || []).map((g: { id: string }) => g.id));
const fps = rig.output?.fps || FPS;

// The studio's static checks (shared/schemas/generated.ts), so nothing is silently dropped.
if (typeof look.title !== 'string' || !look.title.trim()) errors.push('title is missing');
else if (look.title.length > LIMITS.title) warnings.push(`title is over ${LIMITS.title} characters and will be cut`);
if (typeof look.summary !== 'string' || !look.summary.trim()) warnings.push('summary is missing');
else if (look.summary.length > LIMITS.summary) {
  warnings.push(`summary is over ${LIMITS.summary} characters and will be cut`);
}
const layers = Array.isArray(look.layers) ? look.layers : [];
if (!layers.length) errors.push('layers is empty');
if (look.duration != null && !goodDuration) {
  warnings.push(`duration must be 1..${LIMITS.duration} seconds; the studio will use 30`);
}
if (layers.length > LIMITS.layers) errors.push(`${layers.length} layers: at most ${LIMITS.layers}`);

// A layer's soften as the studio stores it (generated.ts): its own when it gives a radius, else the default.
const softenOf = (s: { radius?: unknown, mode?: unknown } | null | undefined) => (typeof s?.radius === 'number'
  && Number.isFinite(s.radius) ? { radius: Math.round(Math.min(core.MAX_RADIUS, Math.max(0, s.radius)) * 1000) / 1000,
    mode: core.BLUR_MODES.includes(s.mode as Core.BlurMode) ? s.mode : 'wire' } : core.DEFAULT_SOFTEN);
const prepared: Core.PreparedLayer[] = [];
let scene: Core.Scene;
try { scene = core.prepareScene(rig); } catch (e) { fail(`the runtime could not read the rig: ${why(e)}`); }
const runnable: Core.LayerInput[] = []; // the layers as the studio will run them, for the bake
layers.slice(0, LIMITS.layers).forEach((layer: any, i: number) => {
  const name = `layer ${i + 1}${layer?.title ? ` (${layer.title})` : ''}`;
  const chain = Array.isArray(layer?.modules);
  if (!layer || (!chain && typeof layer.code !== 'string')) return errors.push(`${name}: no code or modules`);
  const modules = chain ? layer.modules : [{ kind: 'source', code: layer.code }];
  if (chain && (!modules.length || modules.length > LIMITS.modules)) {
    errors.push(`${name}: 1 to ${LIMITS.modules} modules`);
  }
  modules.forEach((m: { kind?: string, code?: unknown }, j: number) => {
    const what = chain ? `${name}, module ${j + 1}` : name, fn = FUNCTION[m?.kind ?? 'source'];
    if (!fn || typeof m.code !== 'string') return errors.push(`${what}: needs a kind (source, warp, filter) and code`);
    if (Buffer.byteLength(m.code, 'utf8') > LIMITS.codeBytes) errors.push(`${what}: code is over 20 kB`);
    const defines = new RegExp(`\\bfunction\\s+${fn}\\s*\\(`);
    if (!defines.test(m.code)) errors.push(`${what}: code must define function ${fn}`);
  });
  const groups = Array.isArray(layer.groups) ? layer.groups : [];
  const tags = Array.isArray(layer.tags) ? layer.tags.filter((t: unknown) => typeof t === 'string') : [];
  const unknown = groups.filter((g: string) => !groupIds.has(g));
  if (!groups.length && !tags.length) warnings.push(`${name}: no groups, it will land on the whole rig`);
  if (unknown.length && !tags.length) errors.push(`${name}: unknown group ids ${unknown.join(', ')}`);
  if (layer.blend != null && !BLENDS.includes(layer.blend)) {
    errors.push(`${name}: blend must be one of ${BLENDS.join(', ')}`);
  }
  if (layer.level != null && !(typeof layer.level === 'number' && layer.level >= 0 && layer.level <= 1)) {
    errors.push(`${name}: level must be a number 0..1`);
  }
  // Clips: what the runtime keeps (normalizeClips) is what the studio keeps; say what goes.
  const clips = layer.clips == null ? null : core.normalizeClips(layer.clips);
  const lost = Array.isArray(layer.clips) ? layer.clips.length - (clips ? clips.length : 0) : 0;
  if (layer.clips != null && !Array.isArray(layer.clips)) {
    errors.push(`${name}: clips must be an array of { start, end, fadeIn, fadeOut }`);
  } else if (lost) {
    const why = `invalid, overlap another or are over ${LIMITS.clips}`;
    warnings.push(`${name}: ${lost} clip(s) are ${why}, and will be dropped`);
  }
  if (clips && clips.some((c) => c.end > LIMITS.duration)) {
    errors.push(`${name}: clips must end by ${LIMITS.duration} s`);
  }
  if (clips && clips.every((c) => c.start >= DURATION)) {
    warnings.push(`${name}: every clip starts after the look ends (${DURATION} s), so it never shows`);
  }
  const known = groups.filter((g: string) => groupIds.has(g));
  const l = {
    id: `l${i + 1}`, title: layer.title, groups: known, ...(tags.length ? { tags } : {}),
    blend: BLENDS.includes(layer.blend) ? layer.blend : 'add', level: typeof layer.level === 'number' ? layer.level : 1,
    ...(chain ? { modules: layer.modules } : { code: layer.code,
      params: layer.params && typeof layer.params === 'object' ? layer.params : {} }), ...(clips ? { clips } : {}),
    soften: softenOf(layer.soften),
    ...(layer.palette && typeof layer.palette === 'object' ? { palette: layer.palette } : {}),
  };
  let compiled;
  try { compiled = core.compileLayer(l); } catch (e) { return errors.push(`${name}: does not compile: ${why(e)}`); }
  try {
    prepared.push(core.prepareLayer(scene, l, compiled));
    runnable.push(l);
  } catch (e) { errors.push(`${name}: could not be prepared: ${why(e)}`); }
});

// Render: a few spot frames, then two seconds at the rig's fps for timing and flicker.
if (prepared.length && !errors.length) {
  const count = rig.count;
  const layerErrors = new Map<unknown, string>();
  const means: number[] = [];
  const lookState = core.prepareLook(lookGlobals);
  let worst = 0, total = 0, frames = 0, dark = 0, nan = 0;
  // Spot frames spread over the look's duration, then two seconds from its middle.
  const times = [0, 0.012, 0.063, 0.24, 0.55, 0.94].map((k) => +(k * DURATION).toFixed(3));
  const mid = Math.max(0, DURATION / 2 - 1);
  for (let f = 0; f < 2 * fps; f++) times.push(mid + f / fps);
  for (const [n, t] of times.entries()) {
    const t0 = performance.now();
    let out;
    try { out = core.renderFrame(scene, prepared, t, undefined, lookState); } catch (e) {
      errors.push(`render at t=${t}: ${why(e)}`);
      break;
    }
    const ms = performance.now() - t0;
    total += ms;
    frames++;
    worst = Math.max(worst, ms);
    for (const e of out.errors || []) if (!layerErrors.has(e.id)) layerErrors.set(e.id, `${e.error} (t=${t})`);
    const rgb = out.rgb;
    let sum = 0, off = 0;
    for (let k = 0; k < count; k++) {
      const r = rgb[3 * k], g = rgb[3 * k + 1], b = rgb[3 * k + 2];
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) nan++;
      const v = Math.max(r, g, b);
      sum += v;
      if (v < 0.04) off++;
    }
    if (n < 6) dark += off / Math.max(1, count);
    else means.push(sum / Math.max(1, count));
  }
  for (const [id, e] of layerErrors) errors.push(`${id} threw or returned NaN: ${e}`);
  if (nan) errors.push(`${nan} channel values were not finite numbers`);
  const avg = total / Math.max(1, frames);
  console.log(`rendered ${frames} frames of ${count} LEDs: ${avg.toFixed(1)} ms average, ${worst.toFixed(1)} ms worst`);
  if (avg > 800 / fps) {
    warnings.push(`slow: ${avg.toFixed(1)} ms a frame on average; the show runs at ${fps} fps (${1000 / fps} ms)`);
  }
  const darkShare = dark / 6;
  if (darkShare > 0.6) {
    const share = `${Math.round(darkShare * 100)}%`;
    warnings.push(`${share} of LEDs are dark on average: darkness is punctuation, not the picture`);
  }
  // Large-area flicker: count brightness reversals of the whole rig's mean over 2 s.
  let flips = 0;
  for (let i = 2; i < means.length; i++) {
    const a = means[i - 1] - means[i - 2];
    const b = means[i] - means[i - 1];
    if (a * b < 0 && Math.abs(a) + Math.abs(b) > 0.08) flips++;
  }
  if (flips / 2 > 6) {
    const rate = (flips / 4).toFixed(1);
    warnings.push(`the whole look flashes about ${rate} times a second: keep large-area flashing under 3 Hz`);
  }
}

for (const w of warnings) console.log(`! ${w}`);
for (const e of errors) console.log(`✗ ${e}`);
if (errors.length) process.exit(1);
const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;
const warned = warnings.length ? `, ${plural(warnings.length, 'warning')}` : '';
console.log(`✓ ${file} passes (${plural(layers.length, 'layer')}${warned})`);
if (BAKE) await bake();

async function bake() {
  if (!existsSync(new URL('./fseq.ts', import.meta.url))) fail('fseq.ts must sit next to check.ts to bake');
  const { ledRanges, writeFseq }: typeof Fseq = await import(beside('fseq.ts'));
  const ranges = ledRanges(rig);
  // A fresh renderer, so state a pattern keeps between frames starts clean at t = 0.
  const r = renderer(core, rig, runnable, ranges, { ...lookGlobals, library });
  const frames = Math.max(1, Math.round(SECONDS * fps));
  const { data, ...baked } = bakeLoop(frames, r.packed, () => r.next(), fps);
  const channelCount = r.packed.length;
  const dir = path.dirname(path.resolve(file));
  const fseq = writeFseq({ frames, stepMs: Math.round(1000 / fps), data, ranges });
  writeFileSync(path.join(dir, 'frames.fseq'), fseq);
  const stats: Record<string, unknown> & typeof baked = { look: path.basename(file), ...baked, seconds: SECONDS, fps,
    channels: channelCount, ranges: ranges.length, bytes: fseq.length };
  const failed = stats.layers.map((l) => `${l.id} threw or returned NaN in ${l.errorFrames} frames: ${l.firstError}`);
  console.log(`baked ${SECONDS} s (${frames} frames × ${channelCount} channels in ${ranges.length} ranges) → `
    + `frames.fseq, ${(fseq.length / 1e6).toFixed(1)} MB; ${stats.msPerFrame.average} ms a frame`);
  if (existsSync(new URL('./frames.ts', import.meta.url))) {
    // The studio's own checks, run here so the worker sees what the studio will see.
    const { analyzeFrames, flickerReason, flickerWarning, parseFseq }: typeof Frames =
      await import(beside('frames.ts'));
    const a = analyzeFrames(parseFseq(fseq, { maxChannels: scene.frameChannels }), scene, core.flashRegions(scene));
    stats.selfCheck = a;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    console.log(`frames: peak ${pct(a.peakBrightness)} of all-white (≈ ${a.estPeakAmps} A at 5 V), mean `
      + `${pct(a.meanBrightness)}, dark ${pct(a.darkFraction)}, flashes up to ${a.flicker.maxHz} a second`);
    if (!a.flicker.ok) {
      failed.push(`${flickerReason(a)} The studio will refuse this bake: slow the large-area changes down.`);
    }
    if (flickerWarning(a)) console.log(`! ${flickerWarning(a)}`);
  }
  writeFileSync(path.join(dir, 'stats.json'), JSON.stringify(stats, null, 2) + '\n');
  for (const e of failed) console.log(`✗ ${e}`);
  if (failed.length) process.exit(1);
  console.log('✓ frames.fseq and stats.json written');
}
