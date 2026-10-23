#!/usr/bin/env node
// node render.ts --out DIR [--seconds S] [--frame-ms 2000] < look.json
// src/render-box.ts supplies isolation and resource limits. Patterns run in a stdlib-only node:vm realm;
// inputs enter as JSON and only bytes, numbers and JSON text leave it.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import type * as Fseq from '../public/js/fseq.ts';
import { bakeFile, bakeId, bakeSeconds, FPS, readLibrary, renderer } from './renderer.ts';

// The FSEQ writer sits beside this file in the box (src/render-box.ts binds it there).
const { ledRanges, writeFseqHeader }: typeof Fseq = await import(new URL('fseq.ts', import.meta.url).href);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_LOOK_BYTES = 1024 * 1024;
const argv = process.argv.slice(2);
const option = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const outDir = option('--out');
const frameMs = Math.min(600_000, Math.max(10, Math.round(Number(option('--frame-ms'))))) || 2000;
const frameWallMs = 10 * frameMs; // Scheduling delays do not consume the frame's CPU budget.
// Loading compiles the core and every layer and lays out the whole rig: many frames' work, at the box's low priority.
const loadMs = 10 * frameMs;
if (!outDir) {
  console.error('usage: node render.ts --out DIR [--seconds S] [--frame-ms 2000] < look.json');
  process.exit(2);
}

const result: Record<string, unknown> = { ok: false };
function finish(code: number): never {
  writeFileSync(path.join(outDir!, 'result.json'), JSON.stringify(result));
  process.exit(code);
}
function fail(error: string): never { result.error = String(error).slice(0, 500); finish(1); }

let look: { layers?: unknown, globals?: unknown, automation?: unknown, bpm?: unknown, duration?: unknown };
try {
  const input = readFileSync(0);
  if (input.length > MAX_LOOK_BYTES) fail('the look is over 1 MB');
  look = JSON.parse(input.toString('utf8'));
} catch {
  fail('the look is not JSON');
}
const layers = Array.isArray(look?.layers) ? look.layers : [];
if (!layers.length) fail('the look has no layers');
const rigText = readFileSync(path.join(HERE, 'rig.json'), 'utf8');
const rig = JSON.parse(rigText);
const ranges = ledRanges(rig), fps = rig.output?.fps || FPS;
const extra = { globals: look.globals, automation: look.automation, bpm: look.bpm,
  library: readLibrary(path.join(HERE, 'patterns')) };

const core = readFileSync(path.join(HERE, 'pattern-core.js'), 'utf8')
  .replace(/^export\s+(?=(?:const|let|var|function|class|async)\b)/gm, '');
if (/^\s*(?:export|import)\b/m.test(core)) fail('pattern-core.js uses module syntax the render box cannot load');

const context = vm.createContext(Object.create(null), {
  name: 'pattern',
  codeGeneration: { strings: true, wasm: false }, // compilePattern needs new Function
  microtaskMode: 'afterEvaluate', // promise jobs run inside each timed call
});
context.__input = JSON.stringify({ layers, ranges, extra });
context.__rig = rigText;

const DRIVER = `(function () {
'use strict';
// Built-ins as locals: faster than global lookups through the context's global object, and out
// of reach of a pattern that reassigns globalThis.Math and the like.
const { Math, Array, Error, TypeError, Float32Array, Float64Array, Int32Array, Uint8Array, Uint32Array, JSON, Map, Set,
  Number, Object, String, Function, isFinite, parseInt } = globalThis;
const __in = JSON.parse(globalThis.__input);
const __rig = JSON.parse(globalThis.__rig);
delete globalThis.__input;
delete globalThis.__rig;
const __noop = function () {};
Object.defineProperty(globalThis, 'console', { value: Object.freeze({ log: __noop, info: __noop, warn: __noop,
  error: __noop, debug: __noop }) });
const core = (function () {
${core}
;return { prepareScene, prepareLayer, compileLayer, prepareLook, setLibrary, renderFrame, toChannels, describeError };
})();
${renderer}
const r = renderer(core, __rig, __in.layers, __in.ranges, __in.extra);
const errorText = (errors) => (errors.length
  ? JSON.stringify(errors.map((e) => ({ id: String(e.id), error: String(e.error).slice(0, 300) }))) : '');
Object.defineProperty(globalThis, '__next', { value: () => errorText(r.next()) });
return { packed: r.packed, compileErrors: JSON.stringify(r.compileErrors) };
})()`;

// The main realm reads results with its own built-ins only: a pattern may have replaced the
// pattern realm's prototypes, so nothing from there is called or has its properties walked.
const TA_LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length')!.get!;
const text = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : '');
const timedOut = (e: unknown) => (e as { code?: string })?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
const channels = ranges.reduce((n, r) => n + r[1], 0);
let packed: unknown;
try {
  const setup = vm.runInContext(DRIVER, context, { timeout: loadMs, filename: 'render-box' });
  packed = setup.packed;
  const compileErrors = JSON.parse(text(setup.compileErrors, 64 * 1024) || '[]');
  if (compileErrors.length) {
    result.compileErrors = compileErrors;
    fail(`layer ${compileErrors[0].id} does not compile: ${compileErrors[0].error}`);
  }
} catch (e) {
  fail(timedOut(e) ? `loading the layers took over ${loadMs} ms`
    : `the look could not be loaded: ${(e as Error)?.message}`);
}
if (!ArrayBuffer.isView(packed) || TA_LENGTH.call(packed) !== channels) {
  fail('the render realm returned no frame buffer');
}

const frames = Math.max(1, Math.round(bakeSeconds(look, option('--seconds')) * fps));
const step = new vm.Script('__next()', { filename: 'render-box-frame' });
const header = writeFseqHeader({ frames, stepMs: Math.round(1000 / fps), ranges,
  uniqueId: bakeId(rig, layers, extra, frames) });
const frame = new Uint8Array(channels); // Node's file APIs must see only host-owned buffers and prototypes.
const baked = bakeFile(path.join(outDir, 'frames.fseq'), header, frames, frame, (f) => {
  const cpu = process.cpuUsage();
  const at = `t = ${(f / fps).toFixed(2)} s`;
  const overCpu = () => Object.values(process.cpuUsage(cpu)).reduce((sum, n) => sum + n, 0) > frameMs * 1000;
  const cpuError = `a layer took over ${frameMs} ms of CPU on the frame at ${at}`;
  let errors;
  try {
    errors = step.runInContext(context, { timeout: frameWallMs });
  } catch (e) {
    if (timedOut(e) && overCpu()) fail(cpuError);
    fail(timedOut(e) ? `a layer took over ${frameWallMs} ms of wall time on the frame at ${at}`
      : `rendering stopped at ${at}`);
  }
  if (overCpu()) fail(cpuError);
  frame.set(packed as Uint8Array);
  return JSON.parse(text(errors, 64 * 1024) || '[]');
}, fps);
if (baked.layers.length) {
  result.layers = baked.layers;
  fail(`layer ${baked.layers[0]!.id} failed: ${baked.layers[0]!.firstError}`);
}

const { data, ...stats } = baked;
Object.assign(result, { ok: true, ...stats, channels, ranges: ranges.length });
finish(0);
