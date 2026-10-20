// The three runtimes agree on a composed look: the render box (bubblewrap, the bundled core in a node:vm realm,
// the library from its read-only mount) bakes the same bytes as the core run here through renderer.ts, the
// renderer the Fleet box bakes with, on the Folly and on the mini rig (its own fps, GRB, tags for the Folly's ids).
// Where bubblewrap is missing the box half skips and says why.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import * as core from '../public/js/pattern-core.ts';
import { ledRanges } from '../public/js/fseq.ts';
import { bakeLoop, readLibrary, renderer } from '../render-box/renderer.ts';
import { parseFseq } from '../src/frames.ts';
import { createRenderBox } from '../src/render-box.ts';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const lib = (name) => fs.readFileSync(path.join(PUBLIC, 'patterns', `${name}.js`), 'utf8');
const MINI = fileURLToPath(new URL('./fixtures/rigs/mini.json', import.meta.url));
const RIGS = { folly: path.join(PUBLIC, 'data/rig-folly.json'), cog: path.join(PUBLIC, 'data/rig.json'), mini: MINI };
const readRig = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
const SECONDS = 2;

// A warp, two sources (one only feeding the mask), the mask, globals, automation, a binding and use().
const LOOK = {
  bpm: 100,
  globals: { speed: 1.5, hue: 0.1, saturation: 1.2, level: 0.9, energy: 0.3,
    palette: { name: 'carnival', low: ['#6700cb'], body: ['#ee008e', '#ffe068'], accent: ['#00beaf'], high: [] },
    macros: { storm: { value: 0.2, min: 0, max: 1 } } },
  automation: { energy: [[0, 0.1], [2, 0.9]], storm: [[0, 0], [1.5, 1]] },
  layers: [
    { id: 'base', title: 'Sky', groups: ['cathedral'], tags: ['all'], blend: 'add', level: 1, modules: [{ id: 'u',
      kind: 'source', title: 'Used clouds', code: 'const sky = use("clouds", { cover: 0.3 });\n'
        + 'function pixel(p, t, P, G) {\n  return scale(sky(p, t), 0.4 + 0.4 * G.storm);\n}' }] },
    { id: 'show', title: 'A chase in clouds', groups: ['arches', 'spires'], tags: ['arch', 'spire'], blend: 'over',
      level: 1, modules: [
      { id: 'met', kind: 'source', title: 'Chase', code: lib('single-strand'),
        params: { speed: { mod: 'lfo', shape: 'tri', rate: 1, unit: 'beats', center: 60, depth: 30 } } },
      { id: 'cl', kind: 'source', title: 'Clouds', code: lib('clouds'), as: 'input' },
      { id: 'mask', kind: 'filter', title: 'Mask', code: lib('mask'), input: 'cl',
        params: { cutoff: { mod: 'global', name: 'storm', from: 0.6, to: 0.2 } } },
      { id: 'tint', kind: 'filter', title: 'Recolour', code: lib('recolour') },
      { id: 'w', kind: 'warp', title: 'Mirror', code: lib('mirror'), params: { along: true } },
    ] },
  ],
};

// Blur and soften (SPEC "Spatial modules"): a soft-edged bars layer, and orbiting bars blurred in space by an LFO.
const BLURRED = {
  layers: [
    { id: 'bars', groups: ['arches'], tags: ['arch'], blend: 'add', level: 1, soften: { radius: 0.15, mode: 'wire' },
      modules: [{ id: 'b', kind: 'source', title: 'Bars', code: lib('bars'), params: { softness: 0 } }] },
    { id: 'rose', groups: ['rose-window'], tags: ['rose'], blend: 'over', level: 1, modules: [
      { id: 'p', kind: 'source', title: 'Bars', code: lib('bars'), params: { direction: 'orbit', profile: 'comet' } },
      { id: 'bl', kind: 'filter', title: 'Blur', code: lib('blur'),
        params: { radius: { mod: 'lfo', rate: 0.5, center: 0.6, depth: 0.3 }, mode: 'both' } }] },
  ],
};

/** The look baked here, by the core through renderer.ts, as the Fleet box bakes it. */
function bakeHere(look, rig = readRig(RIGS.folly)) {
  const ranges = ledRanges(rig), fps = rig.output.fps;
  const r = renderer(core, rig, look.layers, ranges, { globals: look.globals, automation: look.automation,
    bpm: look.bpm, library: readLibrary(path.join(PUBLIC, 'patterns')) });
  assert.deepEqual(r.compileErrors, []);
  const baked = bakeLoop(SECONDS * fps, r.packed, () => r.next(), fps);
  assert.deepEqual(baked.layers, [], 'no layer errors');
  return baked;
}

test('a composed look bakes in-process on either rig: lit, deterministic, and it costs the time it says', () => {
  const a = bakeHere(LOOK), b = bakeHere(LOOK);
  assert.deepEqual(a.data, b.data);
  assert.ok(a.data.some((v) => v > 0));
  const small = bakeHere(LOOK, readRig(MINI));
  assert.equal(small.frames, SECONDS * 30, 'the mini rig plays at 30 fps');
  assert.equal(small.data.length, small.frames * 148 * 3);
  assert.ok(small.data.some((v) => v > 0));
  const plain = bakeHere({ layers: [{ id: 'p', groups: ['arches', 'spires'], code: lib('single-strand') }] });
  console.info(`per frame: composed look ${a.msPerFrame.average} ms, a chase alone ${plain.msPerFrame.average} ms`);
});

const probe = await createRenderBox({ log: quiet }).probe();
const unavailable = `render box unavailable here: ${probe.reason}`;

for (const [name, rigFile] of Object.entries(RIGS)) {
  test(`the render box bakes the composed look to the same bytes as the core here (${name})`, async ({ skip }) => {
    skip(!probe.ok, unavailable);
    const box = createRenderBox({ seconds: SECONDS, rigFile, log: quiet });
    const { layers, globals, automation, bpm } = LOOK;
    const { bytes } = await box.render({ layers, seconds: SECONDS, globals, automation, bpm });
    const parsed = parseFseq(bytes);
    const rig = readRig(rigFile);
    assert.equal(parsed.frameCount, SECONDS * rig.output.fps);
    assert.equal(parsed.stepMs, Math.round(1000 / rig.output.fps));
    const here = bakeHere(LOOK, rig).data;
    assert.equal(parsed.data.length, here.length);
    assert.ok(Buffer.from(parsed.data).equals(Buffer.from(here)), 'the box and the core bake the same bytes');
  });
}

test('the render box bakes blur and soften to the same bytes as the core here', async ({ skip }) => {
  skip(!probe.ok, unavailable);
  const box = createRenderBox({ seconds: SECONDS, rigFile: RIGS.folly, log: quiet });
  const { bytes } = await box.render({ layers: BLURRED.layers, seconds: SECONDS });
  const here = bakeHere(BLURRED).data, parsed = parseFseq(bytes);
  assert.ok(here.some((v) => v > 0));
  assert.ok(Buffer.from(parsed.data).equals(Buffer.from(here)), 'the box and the core bake the same bytes');
});
