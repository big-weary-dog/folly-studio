// Love Burn plays our looks from .fseq on another team's player, so every library preset, made a look on the Folly
// (rig-folly.json, the default rig), exports a file that player reads as we rendered it: the Studio's Export (the
// sandbox's render loop: the look from t = 0, through the light curve, packed to the LEDs' ranges) and the bake's
// file (render-box/renderer.ts, as render.ts writes it). Each is read back with an independent reader: FSEQ v2.0,
// the rig's fps, frames for the look's length, the channels the rig's LEDs use (their universe and channel, the
// addresses tools/check_channels.py holds to lighting's xLights models and Falcon), and sampled frames equal to the
// render at every LED.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { test } from 'vitest';

import { exportShape, packFrames, writeFseq, writeFseqHeader } from '../core/fseq.ts';
import * as core from '../core/pattern-core.ts';
import { presetLayers, withPresetGlobals } from '../public/js/ui/studio/model.ts';
import { bakeId, bakeLoop, readLibrary, renderer } from '../render-box/renderer.ts';
import type { ModuleEntry, PresetEntry, Rig } from '../shared/schemas/rig.ts';
import { parseFseq } from '../src/frames.ts';
import { readFseq } from './fixtures/fseq-reader.js';
import { libraryIndex, withCode } from './fixtures/patterns.js';

const here = (p: string) => new URL(p, import.meta.url);
const rig = JSON.parse(readFileSync(here('../public/data/rig-folly.json'), 'utf8')) as Rig;
const index = libraryIndex() as { name: string,
  kind: string }[];
const library = index.map(withCode) as (ModuleEntry | PresetEntry)[];
const presets = library.filter((e): e is PresetEntry => e.kind === 'preset');
const uses = readLibrary(new URL('../public/patterns/', import.meta.url).pathname);
const scene = core.prepareScene(rig);
const FULL = rig.output.universes * rig.output.channelsPerUniverse;

// Each LED's first channel in the whole frame (0-based), from the rig alone; its three run on from there.
const cpu = rig.output.channelsPerUniverse;
const addr = rig.pixels.universe.map((u, k) => (u - 1) * cpu + rig.pixels.channel[k] - 1);
/** The LEDs' channels as [start, count] runs: what a sparse file for this rig must carry, no more. */
function ledSpans() {
  const spans: [number, number][] = [];
  for (const a of [...addr].sort((x, y) => x - y)) {
    const last = spans.at(-1);
    if (last && last[0] + last[1] === a) last[1] += 3;
    else spans.push([a, 3]);
  }
  return spans;
}

test('the Folly\'s LEDs each own three channels inside its universes', () => {
  assert.equal(rig.count, 4870);
  assert.equal(new Set(addr).size, rig.count, 'no two LEDs share an address');
  const spans = ledSpans();
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] > spans[i - 1][0] + spans[i - 1][1] - 1, 'no overlap');
  assert.ok(spans.every(([s, n]) => s >= 0 && s + n <= FULL), `inside the ${FULL} channels of its universes`);
  assert.equal(spans.reduce((n, s) => n + s[1], 0), 3 * rig.count);
  assert.deepEqual(exportShape(rig).ranges, spans, 'Export carries exactly the LEDs\' channels');
});

/** A file's header as a player reads it, for `frames` of the Folly at 40 fps over the LEDs' channels. */
function checkHeader(h: ReturnType<typeof readFseq>, bytes: Uint8Array, frames: number, what: string) {
  const spans = ledSpans();
  assert.equal(h.magic, 'PSEQ', what);
  assert.deepEqual([h.major, h.minor], [2, 0], `${what}: FSEQ v2.0`);
  assert.equal(h.headerLength, 32 + 6 * spans.length, `${what}: header length`);
  assert.ok(h.dataOffset >= h.headerLength && h.dataOffset % 4 === 0, `${what}: data offset ${h.dataOffset}`);
  assert.equal(h.channelCount, 3 * rig.count, `${what}: channels a frame`);
  assert.equal(h.frameCount, frames, `${what}: frames`);
  assert.equal(h.stepMs, 25, `${what}: step`);
  assert.equal(1000 / h.stepMs, rig.output.fps, `${what}: the rig's fps`);
  assert.deepEqual([h.flags, h.compression, h.blocks, h.reserved], [0, 0, 0, 0], `${what}: uncompressed`);
  assert.deepEqual(h.ranges, spans, `${what}: sparse ranges`);
  assert.equal(h.variables.sp, 'Folly Studio', what);
  assert.equal(bytes.length, h.dataOffset + frames * h.channelCount, `${what}: file size`);
  const strict = parseFseq(bytes, { maxChannels: FULL });   // the server's own reader takes it too
  assert.deepEqual([strict.channelCount, strict.frameCount, strict.stepMs], [h.channelCount, frames, 25], what);
}

/** Each LED's three bytes in a sparse frame, found through the file's ranges, equal `full` at its address. */
function checkFrame(h: ReturnType<typeof readFseq>, f: number, full: Uint8Array, what: string) {
  const frame = h.frame(f), at = new Map<number, number>();
  let o = 0;
  for (const [start, count] of h.ranges) { for (let c = 0; c < count; c++) at.set(start + c, o + c); o += count; }
  for (let k = 0; k < rig.count; k++) {
    for (let c = 0; c < 3; c++) {
      const a = addr[k] + c, got = frame[at.get(a)!];
      if (got !== full[a]) assert.fail(`${what}, frame ${f}: LED ${k} channel ${a + 1} is ${got}, rendered ${full[a]}`);
    }
  }
}

test('every library preset exports a valid .fseq on the Folly, and reads back as rendered', () => {
  const { fps, stepMs, frameChannels, ranges, used } = exportShape(rig);
  assert.deepEqual([fps, stepMs, frameChannels, used], [40, 25, FULL, 3 * rig.count]);
  const light = core.prepareLight(scene, core.LIGHT), result = { rgb: new Float32Array(0), errors: [] };
  presets.forEach((p, i) => {
    // A short look, its length off the frame grid now and then: Export renders round(seconds × fps) frames.
    const seconds = 0.5 + (i % 4) * 0.2125, frames = Math.round(seconds * fps);
    const layers = presetLayers(p, library, rig)!, globals = withPresetGlobals(null, p);
    const samples = [0, frames >> 1, frames - 1], encoded: Uint8Array[] = [], lit: Uint8Array[] = [];

    // Export: the sandbox's render (sandbox-worker.ts onRender), then export.tsx's pack and write.
    const prepared = layers.map((l) => core.prepareLayer(scene, l, core.compileLayer(l)));
    const look = core.prepareLook({ globals }), rgb = new Float32Array(scene.count * 3);
    const channels = new Uint8Array(frames * frameChannels), frame = new Uint8Array(frameChannels);
    for (let f = 0; f < frames; f++) {
      const { errors } = core.renderFrame(scene, prepared, f / fps, rgb, look, result);
      assert.deepEqual(errors, [], `${p.name} at frame ${f}`);
      channels.set(core.ledChannels(scene, rgb, light, frame, 1), f * frameChannels);
      if (samples.includes(f)) { lit.push(frame.slice()); encoded.push(core.toChannels(scene, rgb).slice()); }
    }
    const file = writeFseq({ frames, stepMs, data: packFrames(channels, frames, frameChannels, ranges), ranges });
    const h = readFseq(file);
    checkHeader(h, file, frames, `${p.name} export`);
    samples.forEach((f, j) => checkFrame(h, f, lit[j], `${p.name} export`));

    // The bake: the render box's renderer and its header, encoded values (SPEC "Light and output").
    const r = renderer(core, rig, layers, ranges, { globals, library: uses });
    assert.deepEqual(r.compileErrors, [], p.name);
    const baked = bakeLoop(frames, r.packed, () => r.next(), fps);
    assert.deepEqual(baked.layers, [], `${p.name}: bake errors`);
    const header = writeFseqHeader({ frames, stepMs, ranges, uniqueId: bakeId(rig, layers, { globals }, frames) });
    const bake = new Uint8Array(header.length + baked.data.length);
    bake.set(header);
    bake.set(baked.data, header.length);
    const b = readFseq(bake);
    checkHeader(b, bake, frames, `${p.name} bake`);
    samples.forEach((f, j) => checkFrame(b, f, encoded[j], `${p.name} bake`));
  });
});
