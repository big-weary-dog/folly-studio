// The three runtimes agree on a composed look: the render box (bubblewrap, the bundled core in a node:vm realm,
// the library from its read-only mount) bakes the same bytes as the core run here through renderer.mjs, the
// renderer the Fleet box bakes with. Where bubblewrap is missing the box half skips and says why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as core from '../public/js/pattern-core.js';
import { ledRanges } from '../public/js/fseq.js';
import { bakeLoop, readLibrary, renderer } from '../render-box/renderer.mjs';
import { parseFseq } from '../src/frames.js';
import { createRenderBox } from '../src/render-box.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const lib = (name) => fs.readFileSync(path.join(PUBLIC, 'patterns', `${name}.js`), 'utf8');
const cathedral = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data/cathedral.json'), 'utf8'));
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
    { id: 'base', title: 'Sky', groups: ['cathedral'], blend: 'add', level: 1, modules: [{ id: 'u', kind: 'source',
      title: 'Used clouds', code: 'const sky = use("clouds", { cover: 0.3 });\nfunction pixel(p, t, P, G) {\n'
        + '  return scale(sky(p, t), 0.4 + 0.4 * G.storm);\n}' }] },
    { id: 'show', title: 'Meteors in clouds', groups: ['arches', 'spires'], blend: 'over', level: 1, modules: [
      { id: 'w', kind: 'warp', title: 'Mirror', code: lib('mirror'), params: { along: true } },
      { id: 'met', kind: 'source', title: 'Meteors', code: lib('meteors'),
        params: { speed: { mod: 'lfo', shape: 'tri', rate: 1, unit: 'beats', center: 60, depth: 30 } } },
      { id: 'cl', kind: 'source', title: 'Clouds', code: lib('clouds'), as: 'input' },
      { id: 'mask', kind: 'filter', title: 'Mask', code: lib('mask'), input: 'cl',
        params: { cutoff: { mod: 'global', name: 'storm', from: 0.6, to: 0.2 } } },
      { id: 'tint', kind: 'filter', title: 'Tint', code: lib('tint') },
    ] },
  ],
};

/** The look baked here, by the core through renderer.mjs, as the Fleet box bakes it. */
function bakeHere(look) {
  const ranges = ledRanges(cathedral);
  const r = renderer(core, cathedral, look.layers, ranges, { globals: look.globals, automation: look.automation,
    bpm: look.bpm, library: readLibrary(path.join(PUBLIC, 'patterns')) });
  assert.deepEqual(r.compileErrors, []);
  const baked = bakeLoop(SECONDS * 40, r.packed, () => r.next());
  assert.deepEqual(baked.layers, [], 'no layer errors');
  return baked;
}

test('a composed look bakes in-process: lit, deterministic, and it costs the time it says', (t) => {
  const a = bakeHere(LOOK), b = bakeHere(LOOK);
  assert.deepEqual(a.data, b.data);
  assert.ok(a.data.some((v) => v > 0));
  const plain = bakeHere({ layers: [{ id: 'p', groups: ['arches', 'spires'], code: lib('meteors') }] });
  t.diagnostic(`per frame: composed look ${a.msPerFrame.average} ms, meteors alone ${plain.msPerFrame.average} ms`);
});

const probe = await createRenderBox({ log: quiet }).probe();
const skip = !probe.ok && `render box unavailable here: ${probe.reason}`;
if (skip) console.log(`# SKIP composed bake in the render box: ${probe.reason}`);

test('the render box bakes the composed look to the same bytes as the core here', { skip }, async () => {
  const box = createRenderBox({ seconds: SECONDS, log: quiet });
  const { layers, globals, automation, bpm } = LOOK;
  const { bytes } = await box.render({ layers, seconds: SECONDS, globals, automation, bpm });
  const parsed = parseFseq(bytes);
  assert.equal(parsed.frameCount, SECONDS * 40);
  const here = bakeHere(LOOK).data;
  assert.equal(parsed.data.length, here.length);
  assert.ok(Buffer.from(parsed.data).equals(Buffer.from(here)), 'the box and the core bake the same bytes');
});
