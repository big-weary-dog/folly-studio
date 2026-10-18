#!/usr/bin/env node
// What brotli quality costs when baked frames are encoded for the wire (src/frames-wire.js): bakes each
// library source, a 3-layer timeline look and an incompressible noise pattern in-process (our own
// library code only), then encodes each at every quality asked, one chunk after another as the server does.
//
//   node tools/frames-bench.mjs [--seconds 20] [--quality 9,11] [--only name,name]
//
// Per quality: the wire's size (MB) and the encode time (s) on one core; last, the raw sparse .fseq (MB).

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { compilePattern, prepareLayer, prepareScene, renderFrame, toChannels } from '../public/js/pattern-core.js';
import { ledRanges, writeFseq } from '../public/js/fseq.js';
import { parseFseq } from '../src/frames.js';
import { encodeWire } from '../src/frames-wire.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SECONDS = Number(arg('--seconds', 20));
const QUALITIES = String(arg('--quality', '9,11')).split(',').map(Number);
const ONLY = arg('--only', '');
const here = (p) => new URL(p, import.meta.url);
const rig = JSON.parse(readFileSync(here('../public/data/rig.json'), 'utf8'));
const index = JSON.parse(readFileSync(here('../public/patterns/index.json'), 'utf8'));
const source = (name) => readFileSync(here(`../public/patterns/${name}.js`), 'utf8');
const scene = prepareScene(rig);
const FPS = scene.fps;

// The channels the rig's LEDs use, as merged spans: what the render box writes.
const ranges = ledRanges(rig);
const channels = ranges.reduce((n, r) => n + r[1], 0);

const NOISE = 'noise (worst case)';
const LOOKS = [
  ...index.filter((p) => (p.kind ?? 'source') === 'source')
    .map(({ name }) => [name, [{ id: 'a', code: source(name) }]]),
  ['timeline (3 layers)', [
    { id: 'bed', code: source('palette-drift') },
    { id: 'meteors', code: source('meteors'), tags: ['arch'],
      clips: [{ start: 2, end: 14, fadeIn: 1, fadeOut: 2 }] },
    { id: 'rose', code: source('rose-chase'), tags: ['rose'], blend: 'over',
      clips: [{ start: 8, end: 20, fadeIn: 2 }] },
  ]],
  [NOISE, [{ id: 'n', // every channel a fresh random byte, every frame
    code: 'function pixel(p, t) { const f = floor(t * 40); return [rand(p.k, f), rand(p.k, f, 2), rand(p.k, f, 3)]; }',
  }]],
].filter(([name]) => !ONLY || ONLY.split(',').some((o) => name.startsWith(o)));

function bake(layers) {
  const prepared = layers.map((l) => prepareLayer(scene, l, compilePattern(l.code)));
  const frames = Math.round(SECONDS * FPS);
  const rgb = new Float32Array(scene.count * 3);
  const full = new Uint8Array(scene.frameChannels);
  const data = new Uint8Array(frames * channels);
  for (let f = 0, o = 0; f < frames; f++) {
    toChannels(scene, renderFrame(scene, prepared, f / FPS, rgb).rgb, full);
    for (const [s, c] of ranges) {
      data.set(full.subarray(s, s + c), o);
      o += c;
    }
  }
  return writeFseq({ frames, data, ranges });
}

const MB = (n) => (n / 1e6).toFixed(2);
const pad = (cells) => cells.map((c, i) => (i ? String(c).padStart(9) : String(c).padEnd(20))).join(' ');
console.log(`${SECONDS} s at ${FPS} fps, ${channels} channels a frame. Wire MB and encode s per brotli quality.`);
console.log(pad(['look', ...QUALITIES.flatMap((q) => [`q${q} MB`, `q${q} s`]), 'raw MB']));
const totals = QUALITIES.map(() => ({ bytes: 0, ms: 0 }));
for (const [name, layers] of LOOKS) {
  const fseq = bake(layers);
  const parsed = parseFseq(fseq, { maxBytes: fseq.length });
  const cells = [];
  for (const [i, quality] of QUALITIES.entries()) {
    const t0 = performance.now();
    const { bytes } = await encodeWire(parsed, { hash: '0'.repeat(32), quality });
    const ms = performance.now() - t0;
    if (name !== NOISE) Object.assign(totals[i], { bytes: totals[i].bytes + bytes, ms: totals[i].ms + ms });
    cells.push(MB(bytes), (ms / 1000).toFixed(1));
  }
  console.log(pad([name.slice(0, 20), ...cells, MB(fseq.length)]));
}
console.log(pad(['all but noise', ...totals.flatMap((t) => [MB(t.bytes), (t.ms / 1000).toFixed(1)]), '']));
