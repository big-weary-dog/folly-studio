#!/usr/bin/env node
// Folly Studio look checker, for the boxed Fleet worker (not the server: it runs pattern code).
// Usage: node check.mjs [look.json]
// Compiles every layer with the studio's own pattern runtime (pattern-core.js), renders a few
// frames on the real LED map (cathedral.json), and prints problems. Exit 1 if the look would
// be rejected or a layer fails; warnings alone exit 0.

import { readFileSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const LIMITS = { layers: 4, codeBytes: 20 * 1024, title: 80, summary: 400 };
const BLENDS = ['add', 'over', 'max', 'multiply'];
const errors = [];
const warnings = [];

const file = process.argv[2] || 'look.json';
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
const cathedral = JSON.parse(readFileSync(new URL('./cathedral.json', import.meta.url), 'utf8'));
const groupIds = new Set((cathedral.groups || []).map((g) => g.id));

// --- the studio's static checks (validate.js), so nothing is silently dropped -------------
if (typeof look.title !== 'string' || !look.title.trim()) errors.push('title is missing');
else if (look.title.length > LIMITS.title) warnings.push(`title is over ${LIMITS.title} characters and will be cut`);
if (typeof look.summary !== 'string' || !look.summary.trim()) warnings.push('summary is missing');
else if (look.summary.length > LIMITS.summary) warnings.push(`summary is over ${LIMITS.summary} characters and will be cut`);
const layers = Array.isArray(look.layers) ? look.layers : [];
if (!layers.length) errors.push('layers is empty');
if (layers.length > LIMITS.layers) errors.push(`${layers.length} layers: at most ${LIMITS.layers}`);

const prepared = [];
let scene;
try {
  scene = core.prepareScene(cathedral);
} catch (e) {
  console.error(`✗ the runtime could not prepare the cathedral: ${e.message}`);
  process.exit(1);
}
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
  };
  try {
    prepared.push(core.prepareLayer(scene, l, compiled));
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
  const times = [0, 0.37, 1.9, 7.25, 33.3, 121.7];
  for (let f = 0; f < 80; f++) times.push(10 + f / 40);
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
