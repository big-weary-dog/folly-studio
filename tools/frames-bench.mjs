#!/usr/bin/env node
// How small baked frames travel: bakes each library pattern, a 3-layer timeline look and a
// deliberately incompressible noise pattern in-process (our own library code only), then prints
// what each would cost on the wire.
//
//   node tools/frames-bench.mjs [--seconds 20] [--quality 11] [--only name,name]
//
// Columns (MB): raw sparse .fseq; gzip as /frames serves it today; brotli per 80-frame chunk with
// no transform, with frame deltas, planar with deltas; the wire format as served (best layout per
// chunk, brotli), and its gzip fallback (its own layouts); the .fseq download with zstd blocks. enc: encoding the
// wire format; dec: undoing it (brotli, deltas, every frame read), which the browser does.

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

import { compilePattern, prepareLayer, prepareScene, renderFrame, toChannels } from '../public/js/pattern-core.js';
import { writeFseq } from '../public/js/fseq.js';
import { decodeChunk, readFrame } from '../public/js/frames-wire.js';
import { parseFseq } from '../src/frames.js';
import { CHUNK_FRAMES, encodeWire, gzipChunk, layoutChunk, WIRE_QUALITY } from '../src/frames-wire.js';
import { compressFseq, FSEQ_CODEC } from '../src/fseq-codec.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SECONDS = Number(arg('--seconds', 20));
const QUALITY = Number(arg('--quality', WIRE_QUALITY));
const ONLY = arg('--only', '');
const FPS = 40;

const here = (p) => new URL(p, import.meta.url);
const cathedral = JSON.parse(readFileSync(here('../public/data/cathedral.json'), 'utf8'));
const index = JSON.parse(readFileSync(here('../public/patterns/index.json'), 'utf8'));
const source = (name) => readFileSync(here(`../public/patterns/${name}.js`), 'utf8');
const scene = prepareScene(cathedral);

// The channels the LED map uses, as merged spans: what the render box writes.
const used = new Uint8Array(scene.frameChannels);
for (let k = 0; k < cathedral.count; k++) {
  const a = (cathedral.pixels.universe[k] - 1) * cathedral.channelsPerUniverse + cathedral.pixels.channel[k] - 1;
  used.fill(1, a, a + 3);
}
const ranges = [];
for (let c = 0; c < used.length; c++) {
  const last = ranges.at(-1);
  if (!used[c]) continue;
  if (last && last[0] + last[1] === c) last[1]++;
  else ranges.push([c, 1]);
}
const channels = ranges.reduce((n, r) => n + r[1], 0);

const NOISE = 'noise (worst case)';
const LOOKS = [
  ...index.map(({ name }) => [name, [{ id: 'a', code: source(name), groups: ['cathedral'] }]]),
  ['timeline (3 layers)', [
    { id: 'bed', code: source('palette-drift'), groups: ['cathedral'] },
    { id: 'meteors', code: source('meteors'), groups: ['arches'],
      clips: [{ start: 2, end: 14, fadeIn: 1, fadeOut: 2 }] },
    { id: 'rose', code: source('rose-chase'), groups: ['rose-window'], blend: 'over',
      clips: [{ start: 8, end: 20, fadeIn: 2 }] },
  ]],
  [NOISE, [{ id: 'n', groups: ['cathedral'], // every channel a fresh random byte, every frame
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
  return writeFseq({ frames, data, ranges, uniqueId: 1 });
}

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const br = async (bytes) => (await brotli(bytes, { params: {
  [zlib.constants.BROTLI_PARAM_QUALITY]: QUALITY,
  [zlib.constants.BROTLI_PARAM_LGWIN]: 22,
  [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
} })).length;

/** Brotli size of every chunk in one layout, chunks compressed side by side in the thread pool. */
async function chunked(parsed, mode) {
  const sizes = [];
  for (let first = 0; first < parsed.frameCount; first += CHUNK_FRAMES) {
    const count = Math.min(CHUNK_FRAMES, parsed.frameCount - first);
    sizes.push(br(layoutChunk(parsed.data, channels, first, count, mode)).then((n) => n + 1)); // + layout byte
  }
  return (await Promise.all(sizes)).reduce((a, b) => a + b, 0);
}

async function wire(parsed) {
  const chunks = [];
  const modes = {};
  const onChunk = (n, bytes, mode) => {
    chunks[n] = bytes;
    modes[mode] = (modes[mode] || 0) + 1;
  };
  const t0 = performance.now();
  const manifest = await encodeWire(parsed, { hash: '0'.repeat(32), quality: QUALITY, onChunk });
  const enc = performance.now() - t0;
  const t1 = performance.now();
  const frame = new Uint8Array(channels);
  for (let n = 0; n < chunks.length; n++) {
    const chunk = decodeChunk(new Uint8Array(zlib.brotliDecompressSync(chunks[n])), manifest, n);
    for (let j = 0; j < chunk.frames; j++) readFrame(chunk, j, frame);
  }
  const dec = performance.now() - t1;
  const gz = await Promise.all(chunks.map(async (b) => (await gzipChunk(b, channels)).length));
  return { bytes: manifest.bytes, gz: gz.reduce((a, b) => a + b, 0), enc, dec, modes };
}

const MB = (n) => (n / 1e6).toFixed(2);
const cols = ['look', 'raw', 'gzip', 'br', 'Δ+br', 'planarΔ+br', 'wire', 'wire gz', `fseq+${FSEQ_CODEC}`,
  'wire÷gzip', 'enc s', 'dec ms', 'layouts'];
const widths = [20, 6, 6, 6, 6, 10, 6, 7, 9, 9, 6, 6, 0];
const line = (cells) => cells.map((c, i) => (i ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i])))
  .join(' ').trimEnd();

console.log(`${SECONDS} s at ${FPS} fps, ${channels} channels a frame; brotli quality ${QUALITY}, `
  + `chunks of ${CHUNK_FRAMES} frames. Sizes in MB.`);
console.log(line(cols));
const totals = { gzip: 0, wire: 0 };
for (const [name, layers] of LOOKS) {
  const fseq = bake(layers);
  const parsed = parseFseq(fseq, { maxBytes: fseq.length });
  const w = await wire(parsed); // alone, so its time is what one bake costs
  const [gz, plain, delta, planar, packed] = await Promise.all([
    gzip(fseq, { level: 4 }).then((b) => b.length),
    chunked(parsed, 'frames'), chunked(parsed, 'frames-delta'), chunked(parsed, 'planar-delta'),
    compressFseq(parsed).then((b) => b.length),
  ]);
  if (name !== NOISE) {
    totals.gzip += gz;
    totals.wire += w.bytes;
  }
  const modes = Object.entries(w.modes).map(([m, n]) => `${m}×${n}`).join(' ');
  console.log(line([name.slice(0, 20), MB(fseq.length), MB(gz), MB(plain), MB(delta), MB(planar), MB(w.bytes),
    MB(w.gz), MB(packed), (w.bytes / gz).toFixed(2), (w.enc / 1000).toFixed(1), w.dec.toFixed(0), modes]));
}
const times = (totals.gzip / totals.wire).toFixed(1);
console.log(`all but noise: gzip ${MB(totals.gzip)} MB → wire ${MB(totals.wire)} MB (${times}× smaller)`);
