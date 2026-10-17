// The renderer both boxes bake with: render-box/render.mjs (the authoritative bake) and
// fleet-box/check.mjs --bake (the Fleet worker's own). The host binds or copies it next to them.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const FPS = 40;

/** The library's sources in `dir` (index.json and its files), for use(): [{ name, code }]; none if missing. */
export function readLibrary(dir) {
  let index;
  try { index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8')); } catch { return []; }
  const out = [];
  for (const e of Array.isArray(index) ? index.slice(0, 200) : []) {
    if (!e || !/^[a-z0-9-]{1,64}$/.test(e.name) || (e.kind ?? 'source') !== 'source') continue;
    try {
      const code = readFileSync(path.join(dir, `${e.name}.js`), 'utf8');
      if (code.length <= 20 * 1024) out.push({ name: e.name, code });
    } catch { /* listed but missing: use() will not find it */ }
  }
  return out;
}

/** Seconds to bake: `asked` (at most 600) when given, else the look's duration (default 30) up to 120. */
export function bakeSeconds(look, asked) {
  if (Number(asked) > 0) return Math.min(600, Number(asked));
  const d = look?.duration;
  return Number.isFinite(d) && d > 0 ? Math.min(120, d) : 30;
}

/**
 * renderer(core, cathedral, layers, ranges, look?) → { compileErrors, packed, next() → errors }: compiles
 * the layers (each a module chain), then each next() renders the following frame (t = f / 40) into `packed`,
 * which holds only the ranged channels. look: { globals?, automation?, bpm?, library? } (library: what use()
 * runs). Self-contained, because the render box runs its source in the pattern realm: it uses nothing from
 * this module.
 */
export function renderer(core, cathedral, layers, ranges, look) {
  const scene = core.prepareScene(cathedral);
  core.setLibrary(look && look.library);
  const prepared = [];
  const compileErrors = [];
  for (const l of layers) {
    try {
      prepared.push(core.prepareLayer(scene, l, core.compileLayer(l)));
    } catch (e) {
      compileErrors.push({ id: String(l && l.id), error: core.describeError(e).slice(0, 300) });
    }
  }
  const globals = core.prepareLook({ globals: look && look.globals, automation: look && look.automation,
    bpm: look && look.bpm });
  const rgb = new Float32Array(scene.count * 3);
  const full = new Uint8Array(scene.frameChannels);
  const packed = new Uint8Array(ranges.reduce((n, r) => n + r[1], 0));
  let f = 0;
  function next() {
    const out = core.renderFrame(scene, prepared, f++ / 40, rgb, globals);
    core.toChannels(scene, out.rgb, full);
    let o = 0;
    for (const r of ranges) {
      packed.set(full.subarray(r[0], r[0] + r[1]), o);
      o += r[1];
    }
    return out.errors;
  }
  return { compileErrors, packed, next };
}

/**
 * Bake `frames` frames: step(f) renders frame f into `packed` and returns its layer errors. → the
 * frames back to back, with timing and each layer's error count and first error.
 */
export function bakeLoop(frames, packed, step) {
  const data = new Uint8Array(frames * packed.length);
  const layers = new Map();
  let total = 0;
  let worst = 0;
  for (let f = 0; f < frames; f++) {
    const t0 = performance.now();
    const errors = step(f);
    const ms = performance.now() - t0;
    total += ms;
    worst = Math.max(worst, ms);
    data.set(packed, f * packed.length);
    for (const e of errors) {
      const le = layers.get(e.id)
        || { id: e.id, errorFrames: 0, firstError: `${e.error} (t = ${(f / FPS).toFixed(2)} s)` };
      le.errorFrames++;
      layers.set(e.id, le);
    }
  }
  const msPerFrame = { average: +(total / frames).toFixed(2), worst: +worst.toFixed(2) };
  return { data, frames, seconds: frames / FPS, msPerFrame, layers: [...layers.values()] };
}
