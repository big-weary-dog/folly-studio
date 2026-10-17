#!/usr/bin/env node
// Folly Studio look checker, for the boxed Fleet worker (not the server: it runs pattern code).
// Usage: node check.mjs [look.json] [--bake [--seconds S]]
// Compiles every layer with the studio's own pattern runtime (pattern-core.js), renders a few
// frames on the real LED map (cathedral.json), and prints problems. Exit 1 if the look would
// be rejected or a layer fails; warnings alone exit 0.
// --bake then renders the look from t = 0 at 40 fps for its duration (default 30 s, at most
// 120 s unless --seconds says otherwise) and writes frames.fseq (FSEQ v2, sparse:
// only the channels the LED map uses) and stats.json (advisory) next to the look. With
// frames.js present it also runs the studio's own frame checks on the result (the studio repeats
// them on its side; only those count).

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const LIMITS = { layers: 4, codeBytes: 20 * 1024, title: 80, summary: 400, clips: 32, duration: 600 };
const BLENDS = ['add', 'over', 'max', 'multiply'];
const errors = [];
const warnings = [];

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--seconds') || 'look.json';
const BAKE = flag('--bake');
const FPS = 40;
let look;
try {
  look = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`✗ ${file}: ${e.message}`);
  process.exit(1);
}
if (!existsSync(new URL('./pattern-core.js', import.meta.url)) || !existsSync(new URL('./cathedral.json', import.meta.url))) {
  console.error('✗ pattern-core.js and cathedral.json must sit next to check.mjs');
  process.exit(1);
}
const core = await import('./pattern-core.js');
const goodDuration = Number.isFinite(look?.duration) && look.duration >= 1 && look.duration <= LIMITS.duration;
const DURATION = goodDuration ? look.duration : 30;
const askedSeconds = Number(option('--seconds'));
const SECONDS = askedSeconds > 0 ? Math.min(LIMITS.duration, askedSeconds) : Math.min(120, DURATION);
const cathedral = JSON.parse(readFileSync(new URL('./cathedral.json', import.meta.url), 'utf8'));
const groupIds = new Set((cathedral.groups || []).map((g) => g.id));

// --- the studio's static checks (validate.js), so nothing is silently dropped -------------
if (typeof look.title !== 'string' || !look.title.trim()) errors.push('title is missing');
else if (look.title.length > LIMITS.title) warnings.push(`title is over ${LIMITS.title} characters and will be cut`);
if (typeof look.summary !== 'string' || !look.summary.trim()) warnings.push('summary is missing');
else if (look.summary.length > LIMITS.summary) warnings.push(`summary is over ${LIMITS.summary} characters and will be cut`);
const layers = Array.isArray(look.layers) ? look.layers : [];
if (!layers.length) errors.push('layers is empty');
if (look.duration != null && !goodDuration) {
  warnings.push(`duration must be 1..${LIMITS.duration} seconds; the studio will use 30`);
}
if (layers.length > LIMITS.layers) errors.push(`${layers.length} layers: at most ${LIMITS.layers}`);

let prepared = [];
let scene;
try {
  scene = core.prepareScene(cathedral);
} catch (e) {
  console.error(`✗ the runtime could not prepare the cathedral: ${e.message}`);
  process.exit(1);
}
const runnable = []; // [layer as the studio will run it, compiled] for the bake
layers.slice(0, LIMITS.layers).forEach((layer, i) => {
  const name = `layer ${i + 1}${layer?.title ? ` (${layer.title})` : ''}`;
  if (!layer || typeof layer.code !== 'string') return errors.push(`${name}: no code`);
  if (Buffer.byteLength(layer.code, 'utf8') > LIMITS.codeBytes) errors.push(`${name}: code is over 20 kB`);
  if (!/\bfunction\s+pixel\s*\(/.test(layer.code)) errors.push(`${name}: code must define function pixel(p, t, P)`);
  const groups = Array.isArray(layer.groups) ? layer.groups : [];
  const unknown = groups.filter((g) => !groupIds.has(g));
  if (!groups.length) warnings.push(`${name}: no groups, it will land on the whole cathedral`);
  if (unknown.length) errors.push(`${name}: unknown group ids ${unknown.join(', ')}`);
  if (layer.blend != null && !BLENDS.includes(layer.blend)) errors.push(`${name}: blend must be one of ${BLENDS.join(', ')}`);
  if (layer.level != null && !(typeof layer.level === 'number' && layer.level >= 0 && layer.level <= 1)) errors.push(`${name}: level must be a number 0..1`);
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
  let compiled;
  try {
    compiled = core.compilePattern(layer.code);
  } catch (e) {
    return errors.push(`${name}: does not compile: ${e.message}`);
  }
  const l = {
    id: `l${i + 1}`,
    title: layer.title,
    code: layer.code,
    groups: groups.filter((g) => groupIds.has(g)).length ? groups.filter((g) => groupIds.has(g)) : ['cathedral'],
    blend: BLENDS.includes(layer.blend) ? layer.blend : 'add',
    level: typeof layer.level === 'number' ? layer.level : 1,
    params: layer.params && typeof layer.params === 'object' ? layer.params : {},
    ...(clips ? { clips } : {}),
  };
  try {
    prepared.push(core.prepareLayer(scene, l, compiled));
    runnable.push(l);
  } catch (e) {
    errors.push(`${name}: could not be prepared: ${e.message}`);
  }
});

// --- render: a few spot frames, then two seconds at 40 fps for timing and flicker ----------
if (prepared.length && !errors.length) {
  const count = cathedral.count || cathedral.pixels?.zone?.length || 0;
  const layerErrors = new Map();
  const means = [];
  let worst = 0;
  let total = 0;
  let frames = 0;
  let dark = 0;
  let nan = 0;
  // Spot frames spread over the look's duration, then two seconds from its middle.
  const times = [0, 0.012, 0.063, 0.24, 0.55, 0.94].map((k) => +(k * DURATION).toFixed(3));
  const mid = Math.max(0, DURATION / 2 - 1);
  for (let f = 0; f < 80; f++) times.push(mid + f / 40);
  for (const [n, t] of times.entries()) {
    const t0 = performance.now();
    let out;
    try {
      out = core.renderFrame(scene, prepared, t);
    } catch (e) {
      errors.push(`render at t=${t}: ${e.message}`);
      break;
    }
    const ms = performance.now() - t0;
    total += ms;
    frames++;
    worst = Math.max(worst, ms);
    for (const e of out.errors || []) if (!layerErrors.has(e.id)) layerErrors.set(e.id, `${e.error} (t=${t})`);
    const rgb = out.rgb;
    let sum = 0;
    let off = 0;
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
  if (avg > 20) warnings.push(`slow: ${avg.toFixed(1)} ms a frame on average; the show runs at 40 fps (25 ms)`);
  const darkShare = dark / 6;
  if (darkShare > 0.6) warnings.push(`${Math.round(darkShare * 100)}% of LEDs are dark on average: darkness is punctuation, not the picture`);
  // Large-area flicker: count brightness reversals of the whole-cathedral mean over 2 s.
  let flips = 0;
  for (let i = 2; i < means.length; i++) {
    const a = means[i - 1] - means[i - 2];
    const b = means[i] - means[i - 1];
    if (a * b < 0 && Math.abs(a) + Math.abs(b) > 0.08) flips++;
  }
  if (flips / 2 > 6) warnings.push(`the whole look flashes about ${(flips / 4).toFixed(1)} times a second: keep large-area flashing under 3 Hz`);
}

for (const w of warnings) console.log(`! ${w}`);
for (const e of errors) console.log(`✗ ${e}`);
if (errors.length) process.exit(1);
console.log(`✓ ${file} passes (${layers.length} layer${layers.length === 1 ? '' : 's'}${warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''})`);
if (BAKE) await bake();

// --- bake: frames.fseq + stats.json --------------------------------------------------------
async function bake() {
  if (!existsSync(new URL('./fseq.js', import.meta.url))) {
    console.error('✗ fseq.js must sit next to check.mjs to bake');
    process.exit(1);
  }
  const { writeFseq } = await import('./fseq.js');
  // Fresh layers, so state a pattern keeps between frames starts clean at t = 0.
  prepared = runnable.map((l) => core.prepareLayer(scene, l, core.compilePattern(l.code)));
  // Only the channels the LED map uses, as merged contiguous spans (one or two per universe).
  const used = new Uint8Array(scene.frameChannels);
  for (const a of scene.addr) if (a >= 0 && a + 2 < used.length) used[a] = used[a + 1] = used[a + 2] = 1;
  const ranges = [];
  for (let c = 0; c < used.length; c++) {
    if (!used[c]) continue;
    const last = ranges[ranges.length - 1];
    if (last && last[0] + last[1] === c) last[1]++;
    else ranges.push([c, 1]);
  }
  const channelCount = ranges.reduce((n, r) => n + r[1], 0);
  const frames = Math.max(1, Math.round(SECONDS * FPS));
  const data = new Uint8Array(frames * channelCount);
  const rgb = new Float32Array(scene.count * 3);
  const ch = new Uint8Array(scene.frameChannels);
  const layerErrors = new Map(prepared.map((p) => [p.id, { count: 0, first: '' }]));
  let total = 0;
  let worst = 0;
  for (let f = 0, off = 0; f < frames; f++) {
    const t0 = performance.now();
    const out = core.renderFrame(scene, prepared, f / FPS, rgb);
    core.toChannels(scene, out.rgb, ch);
    const ms = performance.now() - t0;
    total += ms;
    worst = Math.max(worst, ms);
    for (const e of out.errors || []) {
      const le = layerErrors.get(e.id) || { count: 0, first: '' };
      if (!le.count) le.first = `${e.error} (t=${(f / FPS).toFixed(2)})`;
      le.count++;
      layerErrors.set(e.id, le);
    }
    for (const [start, count] of ranges) {
      data.set(ch.subarray(start, start + count), off);
      off += count;
    }
  }
  const dir = path.dirname(path.resolve(file));
  const fseq = writeFseq({ frames, stepMs: 1000 / FPS, data, ranges });
  writeFileSync(path.join(dir, 'frames.fseq'), fseq);
  const stats = {
    look: path.basename(file),
    seconds: SECONDS,
    fps: FPS,
    frames,
    channels: channelCount,
    ranges: ranges.length,
    bytes: fseq.length,
    msPerFrame: { average: +(total / frames).toFixed(2), worst: +worst.toFixed(2) },
    layers: [...layerErrors].map(([id, e]) => ({ id, errorFrames: e.count, firstError: e.first.slice(0, 200) })),
  };
  let failed = stats.layers.filter((l) => l.errorFrames).map((l) => `${l.id} threw or returned NaN in ${l.errorFrames} frames: ${l.firstError}`);
  console.log(`baked ${SECONDS} s (${frames} frames × ${channelCount} channels in ${ranges.length} ranges) → frames.fseq, ${(fseq.length / 1e6).toFixed(1)} MB; ${stats.msPerFrame.average} ms a frame`);
  if (existsSync(new URL('./frames.js', import.meta.url))) {
    // The studio's own checks, run here so the worker sees what the studio will see.
    const { analyzeFrames, flickerReason, parseFseq } = await import('./frames.js');
    const a = analyzeFrames(parseFseq(fseq), cathedral);
    stats.selfCheck = a;
    console.log(`frames: peak ${Math.round(a.peakBrightness * 100)}% of all-white (≈ ${a.estPeakAmps} A at 5 V), mean ${Math.round(a.meanBrightness * 100)}%, dark ${Math.round(a.darkFraction * 100)}%, flashes up to ${a.flicker.maxHz} a second`);
    if (!a.flicker.ok) failed.push(`${flickerReason(a)} The studio will refuse this bake: slow the large-area changes down.`);
  }
  writeFileSync(path.join(dir, 'stats.json'), JSON.stringify(stats, null, 2) + '\n');
  for (const e of failed) console.log(`✗ ${e}`);
  if (failed.length) process.exit(1);
  console.log('✓ frames.fseq and stats.json written');
}
