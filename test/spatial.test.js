// Spatial modules (SPEC "Spatial modules"): the rig's neighbour graph, the native blur along the wire and in space,
// normalised over the layer's own pixels, `soften`, and the staged chain, which is exact where its op is the identity
// and leaves chains without spatial modules on their one pass. On the Folly and the mini rig.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import {
  compileLayer, compileModule, DEFAULT_SOFTEN, MAX_RADIUS, neighbourGraph, normalizeParams, prepareLayer, prepareScene,
  renderFrame, resolveParams, STDLIB, toChannels,
} from '../public/js/pattern-core.ts';
import { folly, mini } from './fixtures/rigs.js';

const lib = (name) => readFileSync(new URL(`../public/patterns/${name}.js`, import.meta.url), 'utf8');
const scene = prepareScene(folly);
const N = scene.count;
const g = neighbourGraph(scene);
const gauss = (d, r) => Math.exp(-2 * (d / r) ** 2);
const layerOf = (layer, S = scene) => prepareLayer(S, layer, compileLayer(layer));
const rgbOf = (layers, t = 0, S = scene) => Float32Array.from(renderFrame(S, layers, t).rgb);
const blurMod = (params, id = 'bl') => ({ id, kind: 'filter', title: 'Blur', code: lib('blur'), params });
const arch = folly.fixtures.find((f) => f.id.startsWith('main-arch'));
const LIT = arch.start + 100;                      // one LED mid-arch
const ONE = `function pixel(p) { return p.k === ${LIT} ? [1, 1, 1] : [0, 0, 0]; }`;
const one = (extra) => ({ id: 'one', groups: ['arches'], modules: [{ id: 's', kind: 'source', code: ONE }], ...extra });

/** Pixel k's weights as the blur's: its own 1 (per kernel) and each in-layer neighbour's gaussian, within r. */
function weights(k, r, mode, inLayer) {
  const w = new Map([[k, mode === 'both' ? 2 : 1]]);
  for (const name of mode === 'both' ? ['wire', 'space'] : [mode]) {
    const G = g[name];
    for (let e = G.off[k]; e < G.off[k + 1] && G.d[e] <= r; e++) {
      if (inLayer(G.nb[e])) w.set(G.nb[e], (w.get(G.nb[e]) ?? 0) + gauss(G.d[e], r));
    }
  }
  return w;
}

describe('the neighbour graph', () => {
  test('in space every pair within 1.5 m, along the wire its own fixture by arc length; nearest first, bounded', () => {
    assert.equal(neighbourGraph(scene), g, 'built once per scene');
    const P = (k) => [scene.X[k], scene.Y[k], scene.Z[k]];
    for (const [name, G] of Object.entries(g)) {
      assert.equal(G.off.length, N + 1);
      assert.equal(G.nb.length, G.off[N]);
      for (let k = 0; k < N; k += 7) {
        for (let e = G.off[k]; e < G.off[k + 1]; e++) {
          const j = G.nb[e];
          assert.ok(j !== k && G.d[e] <= MAX_RADIUS + 1e-6, `${name} ${k}→${j}`);
          if (e > G.off[k]) assert.ok(G.d[e] >= G.d[e - 1], `${name} row ${k} sorted`);
          if (name === 'space') assert.ok(Math.abs(Math.hypot(...P(j).map((v, a) => v - P(k)[a])) - G.d[e]) < 1e-5);
          else assert.equal(scene.fixture[j], scene.fixture[k]);
        }
      }
    }
    // Every pair within the radius is found: brute force on a sample.
    for (let k = 0; k < N; k += 97) {
      let want = 0;
      for (let j = 0; j < N; j++) if (j !== k && Math.hypot(...P(j).map((v, a) => v - P(k)[a])) <= MAX_RADIUS) want++;
      assert.equal(g.space.off[k + 1] - g.space.off[k], want, `LED ${k}`);
    }
    // Along an arch (≈ 0.1 m apart) the wire's neighbours are its next LEDs, at their arc lengths.
    const row = Array.from(g.wire.nb.subarray(g.wire.off[LIT], g.wire.off[LIT] + 4)).map((j) => j - LIT);
    assert.deepEqual(row.map(Math.abs), [1, 1, 2, 2]);
    // The cost, bounded: the Folly's 4,870 LEDs have 56 neighbours each in space and 25 along the wire on average.
    const bytes = Object.values(g).reduce((n, G) => n + G.off.byteLength + G.nb.byteLength + G.d.byteLength, 0);
    assert.ok(g.space.nb.length / N < 80 && g.wire.nb.length / N < 40, 'neighbours per LED');
    assert.ok(bytes < 5e6, `${(bytes / 1e6).toFixed(1)} MB`);
    const t0 = performance.now();
    neighbourGraph(prepareScene(folly));
    console.info(`neighbour graph: space ${(g.space.nb.length / N).toFixed(1)}, wire ${(g.wire.nb.length / N)
      .toFixed(1)} a LED, ${(bytes / 1e6).toFixed(2)} MB, built in ${(performance.now() - t0).toFixed(0)} ms`);
  });
});

describe('blur', () => {
  const inArches = new Set(layerOf(one()).idx);
  for (const [mode, r] of [['wire', 0.3], ['space', 0.5], ['both', 0.4]]) {
    test(`one lit LED spreads by gaussian weights (${mode}, ${r} m), normalised at each receiver`, () => {
      const rgb = rgbOf([layerOf(one({ modules: [one().modules[0], blurMod({ radius: r, mode })] }))]);
      const reach = weights(LIT, r, mode, (j) => inArches.has(j));
      assert.ok(reach.size > 3, 'reaches its neighbours');
      for (const [k] of reach) {
        const w = weights(k, r, mode, (j) => inArches.has(j));
        const want = w.get(LIT) / [...w.values()].reduce((a, b) => a + b);
        assert.ok(Math.abs(rgb[3 * k] - want) < 1e-4, `LED ${k - LIT}: ${rgb[3 * k]} vs ${want}`);
      }
      let lit = 0;
      for (let k = 0; k < N; k++) if (rgb[3 * k] > 0) lit++;
      assert.equal(lit, reach.size, 'nothing beyond the radius');
    });
  }

  test('space reaches across fixtures, the wire does not', () => {
    // An LED with another fixture's within 0.5 m (where strands meet), lit alone in the whole rig.
    const other = (k) => {
      for (let e = g.space.off[k]; e < g.space.off[k + 1] && g.space.d[e] <= 0.5; e++) {
        if (scene.fixture[g.space.nb[e]] !== scene.fixture[k]) return g.space.nb[e];
      }
      return -1;
    };
    const k = scene.fixture.findIndex((_, k) => other(k) >= 0), near = other(k);
    const code = `function pixel(p) { return p.k === ${k} ? 1 : 0; }`;
    const dot = { id: 'd', modules: [{ id: 's', kind: 'source', code }] };
    assert.ok(rgbOf([layerOf({ ...dot, soften: { radius: 0.5, mode: 'space' } })])[3 * near] > 0);
    assert.equal(rgbOf([layerOf({ ...dot, soften: { radius: 0.5, mode: 'wire' } })])[3 * near], 0);
  });

  test('normalised over the layer: an evenly lit selection stays even to its edges, and nothing spills out', () => {
    const flat = { id: 'f', groups: ['main-arch-3'], modules: [{ id: 's', kind: 'source',
      code: 'function pixel() { return [0.25, 0.5, 1]; }' }] };
    const plain = rgbOf([layerOf(flat)]);
    for (const mode of ['wire', 'space', 'both']) {
      const blurred = rgbOf([layerOf({ ...flat, soften: { radius: 1.2, mode } })]);
      for (let i = 0; i < 3 * N; i++) assert.ok(Math.abs(blurred[i] - plain[i]) < 1e-6, `${mode} at ${i}`);
    }
  });

  test('amount 0 and radius 0 are the identity, byte for byte; amount mixes', () => {
    const base = one().modules[0];
    const plain = rgbOf([layerOf(one())]);
    assert.deepEqual(rgbOf([layerOf(one({ modules: [base, blurMod({ amount: 0 })] }))]), plain);
    assert.deepEqual(rgbOf([layerOf(one({ modules: [base, blurMod({ radius: 0 })] }))]), plain);
    assert.deepEqual(rgbOf([layerOf(one({ soften: { radius: 0, mode: 'space' } }))]), plain);
    const full = rgbOf([layerOf(one({ modules: [base, blurMod({ radius: 0.4 })] }))]);
    const half = rgbOf([layerOf(one({ modules: [base, blurMod({ radius: 0.4, amount: 0.5 })] }))]);
    for (const k of [LIT, LIT + 1, LIT + 3]) assert.ok(Math.abs(half[3 * k] - (plain[3 * k] + full[3 * k]) / 2) < 1e-6);
  });

  test('alpha: a transparent pixel adds no colour, and blurring spreads coverage', () => {
    const dot = `function pixel(p) { return p.k === ${LIT} ? [1, 0, 0, 1] : [0, 1, 0, 0]; }`;
    const L = layerOf({ id: 'a', groups: ['arches'], blend: 'over', soften: { radius: 0.3, mode: 'wire' },
      modules: [{ id: 's', kind: 'source', code: dot }] });
    renderFrame(scene, [L], 0);
    const j = [...L.idx].indexOf(LIT + 1), o = 4 * j;
    assert.deepEqual([L.buf[o], L.buf[o + 1], L.buf[o + 2]], [1, 0, 0], 'red, never green');
    assert.ok(L.buf[o + 3] > 0.1 && L.buf[o + 3] < 0.5);
  });

  test('bad params: radius held to 1.5 m, nonsense is the identity, an unknown op does not compile', () => {
    const base = one().modules[0];
    assert.deepEqual(rgbOf([layerOf(one({ modules: [base, blurMod({ radius: 9 })] }))]),
      rgbOf([layerOf(one({ modules: [base, blurMod({ radius: 1.5 })] }))]));
    assert.deepEqual(rgbOf([layerOf(one({ modules: [base, blurMod({ radius: -1 })] }))]), rgbOf([layerOf(one())]));
    assert.throws(() => compileModule("const spatial = 'sharpen';\nfunction filter(c) { return c; }", 'filter'),
      /spatial must be 'blur'/);
    // A source or warp may name a variable spatial: it means nothing there.
    assert.equal(compileModule("const spatial = 'x';\nfunction pixel() { return 1; }").spatial, undefined);
    assert.equal(compileModule(lib('blur'), 'filter').spatial, 'blur');
  });
});

describe('the staged chain', () => {
  // A warp, a hidden source a later filter reads, frame() state: everything the stages must carry across.
  const counted = 'let calls = 0;\nfunction frame() { calls++; }\n'
    + 'function pixel(p) { return [p.lz, calls % 7 / 7, p.ly]; }';
  const W = (id = 'w') => ({ id, kind: 'warp', code: lib('mirror'), params: { along: true } });
  const MODS = [
    { id: 'met', kind: 'source', code: lib('meteors') },
    { id: 'cl', kind: 'source', code: lib('clouds'), as: 'input' },
    { id: 'c', kind: 'source', code: counted, blend: 'max' },
    W(),
  ];
  const MASK = { id: 'mask', kind: 'filter', code: lib('mask'), input: 'cl' };
  const look = (modules, extra) => ({ id: 'l', groups: ['arches', 'spires'], blend: 'over', modules, ...extra });

  test('with an identity op between them, each stage bent by its own warp, it is the one pass, byte for byte', () => {
    const plain = layerOf(look([...MODS, MASK]));
    const staged = layerOf(look([MODS[0], W(), blurMod({ amount: 0 }, 'b1'), ...MODS.slice(1, 3), W('w2'),
      blurMod({ radius: 0 }, 'b2'), MASK, blurMod({ amount: 0 }, 'b3')]));
    assert.equal(plain.stages, null);
    assert.ok(staged.stages && staged.chain.find((M) => M.id === 'cl').keep, 'the mask reads clouds across a stage');
    for (const t of [0, 0.5, 3.25, 9]) {
      assert.deepEqual(rgbOf([staged], t), rgbOf([plain], t), `t = ${t}`);
    }
  });

  test('chains without spatial modules keep their one pass; a disabled blur is none', () => {
    const plain = layerOf(look([...MODS, MASK]));
    const off = layerOf(look([...MODS, { ...blurMod({ radius: 1 }), enabled: false }, MASK]));
    assert.equal(off.stages, null);
    assert.deepEqual(rgbOf([off], 1.5), rgbOf([plain], 1.5));
  });

  test('deterministic: a fresh scene and layer bake the same bytes', () => {
    const run = () => {
      const S = prepareScene(folly), L = [layerOf(look([...MODS, blurMod({ radius: 0.7, mode: 'both' }), MASK],
        { soften: DEFAULT_SOFTEN }), S)];
      return toChannels(S, renderFrame(S, L, 2.5).rgb);
    };
    assert.deepEqual(run(), run());
  });

  test('a failing module in a later stage blacks out its layer and is named', () => {
    const L = layerOf(look([MODS[1], blurMod({ radius: 0.2 }), { id: 'bad', kind: 'filter', title: 'Bad',
      code: 'function filter(c) { return [NaN, 0, 0]; }' }]));
    const r = renderFrame(scene, [L], 0);
    assert.equal(r.errors[0].module, 'bad');
    assert.ok(r.rgb.every((v) => v === 0));
  });

  test('soften is a blur at the end of the chain', () => {
    const s = { radius: 0.35, mode: 'space' };
    assert.deepEqual(rgbOf([layerOf(look(MODS, { soften: s }))], 2),
      rgbOf([layerOf(look([...MODS, blurMod({ ...s, amount: 1 })]))], 2));
  });

  test('on the mini rig: z up, a panel and floods; soften keeps it lit and finite', () => {
    const S = prepareScene(mini);
    const L = layerOf({ id: 'm', modules: [{ id: 's', kind: 'source', code: lib('bars') }],
      soften: { radius: 0.5, mode: 'both' } }, S);
    const rgb = rgbOf([L], 1, S);
    assert.ok(rgb.every(Number.isFinite) && rgb.some((v) => v > 0.2));
  });
});

test('a choice param: its value one of its options, else the default (as blur.js takes its mode)', () => {
  const options = ['wire', 'space', 'Bad!', 'both'];
  const schema = normalizeParams({ mode: { value: 'space', type: 'choice', options } });
  assert.deepEqual(schema.mode, { type: 'choice', value: 'space', options: ['wire', 'space', 'both'] });
  assert.deepEqual(resolveParams(schema, { mode: 'both' }), { mode: 'both' });
  assert.deepEqual(resolveParams(schema, { mode: 'fog' }), { mode: 'space' });
  assert.throws(() => normalizeParams({ m: { value: 'a', type: 'choice' } }), /a choice needs options/);
});

describe('soft and band', () => {
  const { soft, band, step } = STDLIB;
  test('soft is an anti-aliased step: step at width 0, smooth and centred on the edge', () => {
    for (const x of [-1, 0.49, 0.5, 2]) assert.equal(soft(0.5, x, 0), step(0.5, x));
    assert.equal(soft(0.5, 0.5, 0.2), 0.5);
    assert.equal(soft(0.5, 0.3, 0.2), 0);
    assert.equal(soft(0.5, 0.7, 0.2), 1);
    assert.ok(soft(0.5, 0.45, 0.2) > 0 && soft(0.5, 0.45, 0.2) < 0.5);
  });

  test('band is 1 within its half-width, 0 beyond, edges soft; narrower than its softness it fades', () => {
    assert.equal(band(3, 3, 1, 0.2), 1);
    assert.equal(band(4, 3, 1, 0.2), 0.5);
    assert.equal(band(4.2, 3, 1, 0.2), 0);
    assert.equal(band(2.5, 3, 1, 0), 1);
    assert.ok(band(3, 3, 0.01, 0.4) < 0.1, 'a sliver dims instead of flashing');
  });
});

describe('cost', () => {
  // The perf demo look (test/e2e/perf.spec.js): a warp, meteors masked by clouds, over the whole rig.
  const DEMO = [{ id: 'm', kind: 'source', code: lib('meteors') }, { id: 'c', kind: 'source', code: lib('clouds'),
    as: 'input' }, { id: 'k', kind: 'filter', code: lib('mask'), input: 'c' },
  { id: 'w', kind: 'warp', code: lib('twist') }];
  const demo = (extra, more = []) => layerOf({ id: 'l', groups: ['cathedral'], modules: [...DEMO, ...more], ...extra });

  test('soften and a 1 m space blur stay cheap beside the demo look (a big blur regression fails)', () => {
    const runs = { plain: demo(), soften: demo({ soften: DEFAULT_SOFTEN }),
      space: demo({}, [blurMod({ radius: 1, mode: 'space' })]) };
    const rgb = new Float32Array(3 * N), ms = { plain: [], soften: [], space: [] };
    for (let f = 0; f < 140; f++) {          // interleaved, so a busy machine slows all three alike
      for (const [name, L] of Object.entries(runs)) {
        const t0 = performance.now();
        renderFrame(scene, [L], f / 40, rgb);
        if (f >= 20) ms[name].push(performance.now() - t0);
      }
    }
    const med = Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, v.sort((a, b) => a - b)[v.length >> 1]]));
    console.info(`a frame of the demo look: ${med.plain.toFixed(2)} ms; soften (${DEFAULT_SOFTEN.radius} m wire) `
      + `${med.soften.toFixed(2)} ms; a 1 m space blur ${med.space.toFixed(2)} ms`);
    // Measured: soften adds about 10 % and the 1 m space blur a third; these bounds are 3–4× what they add.
    assert.ok(med.soften < 1.4 * med.plain, 'soften');
    assert.ok(med.space < 2 * med.plain, 'space blur');
  });
});
