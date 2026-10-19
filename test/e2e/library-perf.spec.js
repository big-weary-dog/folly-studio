// npm run perf, too: what a frame of the built-in library costs, in Node as the render box runs it. Each source over
// the whole Folly, three long chains of warps and filters, each preset's layers, and every source stacked a layer
// each. The unit tests
// (patterns.test.js, library.test.js) time nothing; this does it against a yardstick, as perf.spec.js does: each frame
// takes turns with the fixed reference workload (perf-calibrate.js), ABBA, so whatever slows the machine slows both,
// and each is held to its median pair's cost as a multiple of the reference's.
//   one run: npm run perf -- -g library
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { compileLayer, compilePattern, prepareLayer, prepareScene, renderFrame } from '../../public/js/pattern-core.ts';
import { reference, timer } from './perf-calibrate.js';

// In references, which run in about 3 ms on a typical runner: a 25 ms frame for a source or a chain, 150 ms for the
// stack. Measured: the dearest source 2.6, the dearest chain 2.5, the stack 10 (2.8, 2.9 and 12 with every CPU busy).
const MAX = { source: 8, chain: 8, stack: 50 };
const PAIRS = 16;
const here = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(here(p), 'utf8');
const source = (name) => read(`../../public/patterns/${name}.js`);
const index = JSON.parse(read('../../public/patterns/index.json'));
const sources = index.filter((e) => e.kind === 'source').map((e) => e.name);
const log = (m) => console.log(`perf: library: ${m}`);
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

const mod = (id, kind, extra = {}) => ({ id, kind, code: source(id), ...extra });
const CHAINS = {
  'plasma mapped, sparkled, shifted, faded, turned, mosaicked, repeated': [mod('plasma', 'source'),
    mod('recolour', 'filter'), mod('sparkle', 'source'), mod('hue-shift', 'filter'), mod('edge-fade', 'filter'),
    mod('rotate', 'warp'), mod('mosaic', 'warp'), mod('radial-repeat', 'warp')],
  'a chase masked by clouds, swirled, folded, with trails': [mod('single-strand', 'source'),
    mod('clouds', 'source', { as: 'input' }), mod('mask', 'filter', { input: 'clouds' }), mod('twist', 'warp'),
    mod('scroll', 'warp'), mod('kaleidoscope', 'warp'), mod('mirror', 'warp'), mod('trails', 'filter')],
  'every colour filter over bars': [mod('bars', 'source'), mod('mask', 'filter', { params: { by: 'self' } }),
    mod('posterize', 'filter'), mod('invert', 'filter'), mod('recolour', 'filter'), mod('sparkle', 'source'),
    mod('hue-shift', 'filter')],
};
const KIND = Object.fromEntries(index.map((e) => [e.name, e.kind]));
/** A preset's layers (SPEC "Library"), each module the library's by its ref. */
const presetLayers = (p) => p.layers.map((l, i) => ({ id: `${p.name}-${i}`, blend: l.blend, level: l.level,
  modules: l.modules.map((m, j) => ({ id: m.id ?? `m${j}`, kind: KIND[m.ref], code: source(m.ref), params: m.params,
    blend: m.blend, as: m.as, input: m.input })) }));
const GROUPS = [['cathedral'], ['rose-window'], ['spires'], ['main-arch-3'], ['canopy', 'wash', 'spirelets'],
  ['rose-ring-5']];
const BLENDS = ['add', 'over', 'max', 'multiply'];

test('the library: each source, the long chains and the whole stack, against the reference', () => {
  const scene = prepareScene(JSON.parse(read('../../public/data/rig-folly.json')));
  const out = new Float32Array(scene.count * 3), time = timer(reference);
  /** A frame of these layers as a multiple of the reference: the median of PAIRS turns, warm. */
  const cost = (layers) => {
    for (let f = 0; f < 5; f++) renderFrame(scene, layers, f / 40, out);
    const ratios = [], errors = [];
    for (let k = 0; k < PAIRS; k++) {
      const t = 3 + k / 40, frame = () => {
        const t0 = performance.now(), r = renderFrame(scene, layers, t, out), ms = performance.now() - t0;
        errors.push(...r.errors);
        return ms;
      };
      let ms, ref;
      if (k % 2) [ms, ref] = [frame(), time(t)];
      else [ref, ms] = [time(t), frame()];
      ratios.push(ms / ref);
    }
    expect(errors).toEqual([]);
    return median(ratios);
  };
  const layer = (name, extra) => prepareLayer(scene, { id: name, ...extra }, compilePattern(source(name)));
  const results = [
    ...sources.map((name) => ['source', name, [layer(name, { groups: ['cathedral'] })]]),
    ...Object.entries(CHAINS).map(([what, modules]) => ['chain', what,
      [prepareLayer(scene, { id: 'chain', modules }, compileLayer({ modules }))]]),
    ...index.filter((e) => e.kind === 'preset').map((p) => ['chain', `preset ${p.name}`,
      presetLayers(p).map((l) => prepareLayer(scene, l, compileLayer(l)))]),
    ['stack', `all ${sources.length} sources a layer each`, sources.map((name, i) => layer(name,
      { groups: GROUPS[i % GROUPS.length], blend: BLENDS[i % 4], level: 0.8 }))],
  ].map(([kind, what, layers]) => ({ kind, what, ratio: cost(layers) }));
  log(`a reference run: ${median(Array.from({ length: 9 }, (_, k) => time(k))).toFixed(1)} ms here`);
  for (const kind of Object.keys(MAX)) {
    const mine = results.filter((r) => r.kind === kind).sort((a, b) => b.ratio - a.ratio);
    log(`${kind} (≤ ${MAX[kind]}): ${mine.slice(0, 6).map((r) => `${r.what} ${r.ratio.toFixed(2)}`).join('; ')}`);
    for (const r of mine) {
      expect.soft(r.ratio, `${kind} "${r.what}": a frame, in references`).toBeLessThanOrEqual(MAX[kind]);
    }
  }
});
