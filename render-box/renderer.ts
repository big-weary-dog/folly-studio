// The renderer both boxes bake with: render-box/render.ts (the authoritative bake) and
// fleet-box/check.ts --bake (the Fleet worker's own). The host binds or copies it next to them.
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import type { Span } from '../public/js/fseq.ts';
import type * as Core from '../public/js/pattern-core.ts';
import type { Rig } from '../shared/schemas/rig.ts';

export const FPS = 40; // when the rig gives none (SPEC "Rig": output.fps)
/** Stable FSEQ identity from inputs read outside the pattern realm, shared by both bake entry points. */
export function bakeId(rig: Rig, layers: readonly Core.LayerInput[], extra: unknown, frames: number) {
  return BigInt(`0x${createHash('sha256').update(JSON.stringify({ rig, layers, extra, frames }))
    .digest('hex').slice(0, 16)}`);
}

/** The library's sources in `dir` (index.json and its files), for use(): [{ name, code }]; none if missing. */
export function readLibrary(dir: string) {
  let index;
  try { index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8')); } catch { return []; }
  const out: { name: string, code: string }[] = [];
  for (const e of Array.isArray(index) ? index.slice(0, 200) : []) {
    if (!e || !/^[a-z0-9-]{1,64}$/.test(e.name) || (e.kind ?? 'source') !== 'source') continue;
    try {
      const code = readFileSync(path.join(dir, `${e.name}.js`), 'utf8');
      if (code.length <= 20 * 1024) out.push({ name: e.name, code });
    } catch { /* listed but missing: use() will not find it */ }
  }
  return out;
}

/** Seconds: explicit `asked` up to 600, otherwise duration up to the hosted default cap. */
export function bakeSeconds(look: { duration?: unknown } | null | undefined, asked: unknown) {
  if (Number(asked) > 0) return Math.min(600, Number(asked));
  const d = look?.duration;
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? Math.min(120, d) : 30;
}

/**
 * Compiles the layers (each a module chain); each next() then renders the following frame (t = f / fps) into
 * `packed`, which holds only the ranged channels, and returns its errors. `library`: what use() runs. Self-contained:
 * the render box runs its source in the pattern realm, so it uses nothing from this module.
 */
export function renderer(core: typeof Core, rig: Rig, layers: readonly Core.LayerInput[], ranges: readonly Span[],
  look?: Parameters<typeof Core.prepareLook>[0] & { library?: { name: string, code: string }[] }) {
  const scene = core.prepareScene(rig);
  core.setLibrary(look?.library);
  const prepared: Core.PreparedLayer[] = [];
  const compileErrors: { id: string, error: string }[] = [];
  for (const l of layers) {
    try {
      prepared.push(core.prepareLayer(scene, l, core.compileLayer(l)));
    } catch (e) {
      compileErrors.push({ id: String(l && l.id), error: core.describeError(e).slice(0, 300) });
    }
  }
  const globals = core.prepareLook(look);
  const rgb = new Float32Array(scene.count * 3), full = new Uint8Array(scene.frameChannels);
  const spans = ranges.map(([start, count]) => full.subarray(start, start + count));
  const packed = new Uint8Array(ranges.reduce((n, r) => n + r[1], 0));
  const result = { rgb, errors: [] as { id: string | null, error: string }[] };
  let f = 0;
  function next() {
    const out = core.renderFrame(scene, prepared, f++ / scene.fps, rgb, globals, result);
    core.toChannels(scene, out.rgb, full);
    let o = 0;
    for (const span of spans) { packed.set(span, o); o += span.length; }
    return out.errors;
  }
  return { compileErrors, packed, next };
}

/** Bake packed frames with timing and each layer's error count and first error. */
export function bakeLoop(frames: number, packed: Uint8Array, step: (f: number) => { id: unknown, error: string }[],
  fps = FPS, write?: (frame: Uint8Array) => void) {
  const data = new Uint8Array(write ? 0 : frames * packed.length);
  const layers = new Map<unknown, { id: unknown, errorFrames: number, firstError: string }>();
  let total = 0, worst = 0;
  for (let f = 0; f < frames; f++) {
    const t0 = performance.now();
    const errors = step(f);
    const ms = performance.now() - t0;
    total += ms;
    worst = Math.max(worst, ms);
    if (write) write(packed); else data.set(packed, f * packed.length);
    for (const e of errors) {
      const le = layers.get(e.id)
        || { id: e.id, errorFrames: 0, firstError: `${e.error} (t = ${(f / fps).toFixed(2)} s)` };
      le.errorFrames++;
      layers.set(e.id, le);
    }
  }
  const msPerFrame = { average: +(total / frames).toFixed(2), worst: +worst.toFixed(2) };
  return { data, frames, seconds: frames / fps, msPerFrame, layers: [...layers.values()] };
}

/** Stream the same packed bytes the in-memory bake writes, with one frame retained. */
export function bakeFile(file: string, header: Uint8Array, ...args: Parameters<typeof bakeLoop>) {
  const fd = openSync(file, 'w', 0o600);
  try {
    writeFileSync(fd, header);
    return bakeLoop(args[0], args[1], args[2], args[3], (frame) => writeFileSync(fd, frame));
  } finally { closeSync(fd); }
}
