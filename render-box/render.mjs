#!/usr/bin/env node
// Folly Studio render box: bakes one look into FSEQ frames.
//
//   node render.mjs --out DIR [--seconds S] [--frame-ms 2000]  < look.json
//   → DIR/frames.fseq  FSEQ v2 at 40 fps from t = 0, sparse: only the channels the LED map uses,
//                      for bakeSeconds(look, S) (renderer.mjs); clips are honoured by the core.
//     DIR/result.json  { ok, error?, frames, seconds, channels, ranges, msPerFrame, layers }
//   exit 0 when frames.fseq was written, 1 when the look could not be baked.
//
// src/render-box.js runs this inside bubblewrap: no network, nothing writable but DIR, read-only
// node, this file, renderer.mjs, the bundled core, fseq.js and cathedral.json, rlimits and a wall
// clock. That is the boundary. In here the core is not imported: its source and renderer() run in a
// node:vm realm with the look, so patterns see only the stdlib and the ECMAScript built-ins (no
// process, require, import, fetch or timers): defence in depth. Inputs go in as JSON text, and only
// bytes, numbers and JSON text come back, so no object from this realm reaches pattern code.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { ledRanges, writeFseq } from './fseq.js';
import { bakeLoop, bakeSeconds, FPS, renderer } from './renderer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_LOOK_BYTES = 1024 * 1024;
const argv = process.argv.slice(2);
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const outDir = option('--out');
const frameMs = Math.min(600_000, Math.max(10, Math.round(+option('--frame-ms')))) || 2000;
if (!outDir) {
  console.error('usage: node render.mjs --out DIR [--seconds S] [--frame-ms 2000] < look.json');
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

let look;
try {
  const input = readFileSync(0);
  if (input.length > MAX_LOOK_BYTES) fail('the look is over 1 MB');
  look = JSON.parse(input.toString('utf8'));
} catch {
  fail('the look is not JSON');
}
const layers = look && Array.isArray(look.layers) ? look.layers : null;
if (!layers || !layers.length) fail('the look has no layers');
const cathedralText = readFileSync(path.join(HERE, 'cathedral.json'), 'utf8');
const ranges = ledRanges(JSON.parse(cathedralText));

const core = readFileSync(path.join(HERE, 'pattern-core.js'), 'utf8')
  .replace(/^export\s+(?=(?:const|let|var|function|class|async)\b)/gm, '');
if (/^\s*(?:export|import)\b/m.test(core)) fail('pattern-core.js uses module syntax the render box cannot load');

const context = vm.createContext(Object.create(null), {
  name: 'pattern',
  codeGeneration: { strings: true, wasm: false }, // compilePattern needs new Function
  microtaskMode: 'afterEvaluate', // promise jobs run inside each timed call
});
context.__input = JSON.stringify({ layers, ranges });
context.__cathedral = cathedralText;

const DRIVER = `(function () {
'use strict';
// Built-ins as locals: faster than global lookups through the context's global object, and out
// of reach of a pattern that reassigns globalThis.Math and the like.
const { Math, Array, Error, TypeError, Float32Array, Float64Array, Int32Array, Uint8Array, Uint32Array, JSON, Map, Set,
  Number, Object, String, Function, isFinite, parseInt } = globalThis;
const __in = JSON.parse(globalThis.__input);
const __cathedral = JSON.parse(globalThis.__cathedral);
delete globalThis.__input;
delete globalThis.__cathedral;
const __noop = function () {};
Object.defineProperty(globalThis, 'console', { value: Object.freeze({ log: __noop, info: __noop, warn: __noop,
  error: __noop, debug: __noop }) });
const core = (function () {
${core}
;return { prepareScene, prepareLayer, compilePattern, renderFrame, toChannels, describeError };
})();
${renderer}
const r = renderer(core, __cathedral, __in.layers, __in.ranges);
const errorText = (errors) => (errors.length
  ? JSON.stringify(errors.map((e) => ({ id: String(e.id), error: String(e.error).slice(0, 300) }))) : '');
Object.defineProperty(globalThis, '__next', { value: () => errorText(r.next()) });
return { packed: r.packed, compileErrors: JSON.stringify(r.compileErrors) };
})()`;

// The main realm reads results with its own built-ins only: a pattern may have replaced the
// pattern realm's prototypes, so nothing from there is called or has its properties walked.
const TA_LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get;
const text = (v, max) => (typeof v === 'string' && v.length <= max ? v : '');
const timedOut = (e) => e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
const channels = ranges.reduce((n, r) => n + r[1], 0);
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
  fail(timedOut(e) ? `loading the layers took over ${frameMs} ms` : `the look could not be loaded: ${e && e.message}`);
}
if (!ArrayBuffer.isView(packed) || TA_LENGTH.call(packed) !== channels) {
  fail('the render realm returned no frame buffer');
}

const frames = Math.max(1, Math.round(bakeSeconds(look, option('--seconds')) * FPS));
const step = new vm.Script('__next()', { filename: 'render-box-frame' });
const baked = bakeLoop(frames, packed, (f) => {
  let errors;
  try {
    errors = step.runInContext(context, { timeout: frameMs });
  } catch (e) {
    const at = `t = ${(f / FPS).toFixed(2)} s`;
    fail(timedOut(e) ? `a layer took over ${frameMs} ms on the frame at ${at}` : `rendering stopped at ${at}`);
  }
  return JSON.parse(text(errors, 64 * 1024) || '[]');
});

writeFileSync(path.join(outDir, 'frames.fseq'), writeFseq({ frames, stepMs: 1000 / FPS, data: baked.data, ranges }));
const { data, ...stats } = baked;
Object.assign(result, { ok: true, ...stats, channels, ranges: ranges.length });
finish(0);
