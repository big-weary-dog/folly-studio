#!/usr/bin/env node
// Folly Studio render box: bakes one look into FSEQ frames.
//
//   node render.mjs --out DIR [--seconds 20] [--frame-ms 2000]  < look.json
//   → DIR/frames.fseq  FSEQ v2 at 40 fps, sparse: only the channels the LED map uses
//     DIR/result.json  { ok, error?, frames, seconds, channels, ranges, msPerFrame, layers }
//   exit 0 when frames.fseq was written, 1 when the look could not be baked.
//
// src/bake.js runs this inside bubblewrap: no network, nothing writable but DIR, read-only copies
// of node, this file, pattern-core.js, fseq.js and cathedral.json, rlimits and a wall clock.
// That is the boundary. In here, pattern-core.js is not imported: its source is evaluated in a
// node:vm context together with the look, so compiled patterns see only the stdlib and the
// ECMAScript built-ins (no process, require, import, fetch or timers), much like the browser
// sandbox. That is defence in depth, not the boundary. Inputs go in as JSON text and only bytes,
// numbers and JSON text come back out, so no object from this realm is handed to pattern code.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { writeFseq } from './fseq.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FPS = 40;
const MAX_LOOK_BYTES = 1024 * 1024;

const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const bounded = (v, lo, hi, fallback) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : fallback);
const outDir = option('--out');
const seconds = bounded(option('--seconds'), 1, 60, 20);
const frameMs = bounded(option('--frame-ms'), 10, 600_000, 2000);
if (!outDir) {
  console.error('usage: node render.mjs --out DIR [--seconds 20] [--frame-ms 2000] < look.json');
  process.exit(2);
}

const result = { ok: false };
function finish(code) {
  writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result));
  process.exit(code);
}
function fail(error) {
  result.error = String(error).slice(0, 500);
  finish(1);
}

// --- inputs (main realm, data only) ------------------------------------------------------------
let layers;
try {
  const input = readFileSync(0);
  if (input.length > MAX_LOOK_BYTES) fail('the look is over 1 MB');
  const look = JSON.parse(input.toString('utf8'));
  layers = look && Array.isArray(look.layers) ? look.layers : null;
} catch {
  fail('the look is not JSON');
}
if (!layers || !layers.length) fail('the look has no layers');
const cathedralText = readFileSync(path.join(HERE, 'cathedral.json'), 'utf8');
const cathedral = JSON.parse(cathedralText);

// The channels the LED map uses, as merged contiguous spans: frames hold only these.
const cpu = cathedral.channelsPerUniverse || 510;
const used = new Uint8Array((cathedral.universes || 80) * cpu);
for (let k = 0; k < cathedral.count; k++) {
  const a = (cathedral.pixels.universe[k] - 1) * cpu + (cathedral.pixels.channel[k] - 1);
  if (a >= 0 && a + 2 < used.length) used[a] = used[a + 1] = used[a + 2] = 1;
}
const ranges = [];
for (let c = 0; c < used.length; c++) {
  if (!used[c]) continue;
  const last = ranges[ranges.length - 1];
  if (last && last[0] + last[1] === c) last[1]++;
  else ranges.push([c, 1]);
}
const channelCount = ranges.reduce((n, r) => n + r[1], 0);

// --- the pattern realm -------------------------------------------------------------------------
const core = readFileSync(path.join(HERE, 'pattern-core.js'), 'utf8').replace(/^export\s+(?=(?:const|let|var|function|class|async)\b)/gm, '');
if (/^\s*(?:export|import)\b/m.test(core)) fail('pattern-core.js uses module syntax the render box cannot load');

const context = vm.createContext(Object.create(null), {
  name: 'pattern',
  codeGeneration: { strings: true, wasm: false }, // compilePattern needs new Function
  microtaskMode: 'afterEvaluate', // promise jobs run inside each timed call
});
context.__input = JSON.stringify({ layers, ranges, channelCount, fps: FPS });
context.__cathedral = cathedralText;

const DRIVER = `(function () {
'use strict';
// Built-ins as locals: faster than global lookups through the context's global object, and out
// of reach of a pattern that reassigns globalThis.Math and the like.
const { Math, Array, Error, TypeError, Float32Array, Float64Array, Int32Array, Uint8Array, Uint32Array, JSON, Map, Set, Number, Object, String, Function, isFinite, parseInt } = globalThis;
const __in = JSON.parse(globalThis.__input);
const __cathedral = globalThis.__cathedral;
delete globalThis.__input;
delete globalThis.__cathedral;
const __noop = function () {};
Object.defineProperty(globalThis, 'console', { value: Object.freeze({ log: __noop, info: __noop, warn: __noop, error: __noop, debug: __noop }) });
const { prepareScene, prepareLayer, compilePattern, renderFrame, toChannels, describeError } = (function () {
${core}
;return { prepareScene, prepareLayer, compilePattern, renderFrame, toChannels, describeError };
})();
const scene = prepareScene(JSON.parse(__cathedral));
const prepared = [];
const compileErrors = [];
for (const l of __in.layers) {
  try {
    prepared.push(prepareLayer(scene, l, compilePattern(l && l.code)));
  } catch (e) {
    compileErrors.push({ id: String(l && l.id), error: describeError(e).slice(0, 300) });
  }
}
const rgb = new Float32Array(scene.count * 3);
const full = new Uint8Array(scene.frameChannels);
const packed = new Uint8Array(__in.channelCount);
let f = 0;
function next() {
  const out = renderFrame(scene, prepared, f++ / __in.fps, rgb);
  toChannels(scene, out.rgb, full);
  let o = 0;
  for (const r of __in.ranges) {
    packed.set(full.subarray(r[0], r[0] + r[1]), o);
    o += r[1];
  }
  return out.errors.length ? JSON.stringify(out.errors.map((e) => ({ id: String(e.id), error: String(e.error).slice(0, 300) }))) : '';
}
Object.defineProperty(globalThis, '__next', { value: next });
return { packed, compileErrors: JSON.stringify(compileErrors) };
})()`;

// The main realm reads results with its own built-ins only: a pattern may have replaced the
// pattern realm's prototypes, so nothing from there is called or has its properties walked.
const TA_LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get;
const text = (v, max) => (typeof v === 'string' && v.length <= max ? v : '');

let packed;
try {
  const setup = vm.runInContext(DRIVER, context, { timeout: frameMs, filename: 'render-box' });
  packed = setup.packed;
  const compileErrors = JSON.parse(text(setup.compileErrors, 64 * 1024) || '[]');
  if (compileErrors.length) {
    result.compileErrors = compileErrors;
    fail(`layer ${compileErrors[0].id} does not compile: ${compileErrors[0].error}`);
  }
} catch (e) {
  fail(e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? `loading the layers took over ${frameMs} ms` : `the look could not be loaded: ${e && e.message}`);
}
if (!ArrayBuffer.isView(packed) || TA_LENGTH.call(packed) !== channelCount) fail('the render realm returned no frame buffer');

const frames = seconds * FPS;
const data = new Uint8Array(frames * channelCount);
const step = new vm.Script('__next()', { filename: 'render-box-frame' });
const layerErrors = new Map();
let total = 0;
let worst = 0;
for (let f = 0; f < frames; f++) {
  const t0 = performance.now();
  let errors;
  try {
    errors = step.runInContext(context, { timeout: frameMs });
  } catch (e) {
    fail(e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? `a layer took over ${frameMs} ms on the frame at t = ${(f / FPS).toFixed(2)} s` : `rendering stopped at t = ${(f / FPS).toFixed(2)} s`);
  }
  const ms = performance.now() - t0;
  total += ms;
  if (ms > worst) worst = ms;
  data.set(packed, f * channelCount);
  const list = text(errors, 64 * 1024);
  if (list) {
    for (const e of JSON.parse(list)) {
      const le = layerErrors.get(e.id) || { id: e.id, errorFrames: 0, firstError: `${e.error} (t = ${(f / FPS).toFixed(2)} s)` };
      le.errorFrames++;
      layerErrors.set(e.id, le);
    }
  }
}

writeFileSync(path.join(outDir, 'frames.fseq'), writeFseq({ frames, stepMs: 1000 / FPS, data, ranges }));
Object.assign(result, {
  ok: true,
  frames,
  seconds,
  channels: channelCount,
  ranges: ranges.length,
  msPerFrame: { average: +(total / frames).toFixed(2), worst: +worst.toFixed(2) },
  layers: [...layerErrors.values()],
});
finish(0);
