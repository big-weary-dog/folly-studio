// Looks from before the one rule (a warp bent the modules after it), in their old order, each with the SHA-256 of
// its first 60 DMX frames (t = f / 40, default gamma, the Folly) as the engine of 328a218 rendered them, with this
// tree's library, rig and palettes. test/chain-order.test.js converts each look and renders the same bytes. To make
// the digests again (from studio/; the old core is plain modules, so a copy of public/js is enough):
//   mkdir -p /tmp/v1 && git archive 328a218 public/js | tar -x -C /tmp/v1
//   node --input-type=module -e 'const f = await import("./test/fixtures/chains-v1.js");
//     const core = await import("/tmp/v1/public/js/pattern-core.ts");
//     for (const [name, look] of f.LOOKS) console.log(f.digest(core, look), name);'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { folly } from './rigs.js';

const read = (p) => readFileSync(new URL(`../../public/${p}`, import.meta.url), 'utf8');
const KINDS = Object.fromEntries(JSON.parse(read('patterns/index.json')).map((e) => [e.name, e.kind]));
const pal = (name) => JSON.parse(read('data/palettes.json')).palettes.find((p) => p.name === name);
const OWN = {
  counted: 'let calls = 0;\nfunction frame() { calls++; }\nfunction pixel(p) { return [p.lz, calls % 7 / 7, p.ly]; }\n',
  // A disc whose alpha falls off with r and turns with a: what is under it shows through.
  disc: 'function pixel(p, t) {\n  const a = smoothstep(0.75, 0.25, p.r) * (0.5 + 0.5 * sin(TAU * (3 * p.a - t)));\n'
    + '  return [0.9, 0.3 + 0.5 * p.a, 0.1, a];\n}\n',
};
let n = 0;
/** Library module `name` (or one of OWN), with `extra` fields. */
const m = (name, extra = {}) => ({ id: extra.id ?? `m${++n}`, kind: OWN[name] ? 'source' : KINDS[name], title: name,
  ...(OWN[name] ? {} : { ref: name }), code: OWN[name] ?? read(`patterns/${name}.js`), params: {}, ...extra });
const layer = (title, modules, extra = {}) => ({ id: `l${++n}`, title, groups: ['cathedral'], blend: 'add', level: 1,
  modules, ...extra });

/** [name, look, digest] */
export const LOOKS = [
  ['the perf demo: twist, meteors, clouds as input, mask', { layers: [layer('Storm', [m('twist', { id: 'w' }),
    m('meteors', { id: 'met' }), m('clouds', { id: 'cl', as: 'input' }), m('mask', { id: 'k', input: 'cl' })])],
  globals: { palette: pal('carnival'), energy: 0.7, hue: 0.05, macros: { storm: { value: 0.4, min: 0, max: 1 } } },
  automation: { storm: [[0, 0], [30, 1]] } },
  '32c264f3098b912667df5a0d736c1da1abce246f323e8dc20522be30592a8409'],
  ['three warps lead plasma and four filters', { layers: [layer('Long', [m('radial-repeat'), m('mosaic'),
    m('rotate', { params: { spin: 0.3 } }), m('plasma'), m('gradient-map'), m('hue-shift'), m('sparkle'),
    m('edge-fade')], { groups: [] })] },
  '3d8e2a805042f07616a4649efa3a3db671caaac14852ed78593ed27d2cd66a51'],
  ['four warps lead meteors masked by clouds, then trails', { layers: [layer('Trails', [m('mirror'),
    m('kaleidoscope'), m('scroll'), m('twist'), m('meteors', { id: 'met2' }), m('clouds', { id: 'cl2', as: 'input' }),
    m('mask', { input: 'cl2' }), m('trails')])] },
  'e94e9e30076c14ef130e5ce839bb3d172c45f614327174c5b3fd8b80acb47c50'],
  ['a composed look: mirror, meteors, a bound mask, tint, over a bed', { layers: [layer('Bed', [m('palette-drift')]),
    layer('Composed', [m('mirror', { params: { along: true } }), m('meteors', { id: 'met3' }),
      m('clouds', { id: 'cl3', as: 'input' }), m('mask', { input: 'cl3',
        params: { cutoff: { mod: 'global', name: 'energy', from: 0.6, to: 0.2 } } }), m('tint')],
    { blend: 'over', level: 0.8, clips: [{ start: 0.2, end: 1.2, fadeIn: 0.3, fadeOut: 0.3 }] })],
  globals: { energy: 0.4, palette: pal('chapel'), macros: { storm: { value: 0.5, min: 0, max: 1 } } },
  automation: { energy: [[0, 0.2], [1, 1]] } },
  '7ea1b046fa243f6b84558bc51c13e230f226e4018a2dbdca8e9db0b8fa93257c'],
  ['a warp before a blur reaches the stage after it; soften', { layers: [layer('Staged', [
    m('mirror', { params: { along: true } }), m('meteors', { id: 'met4' }), m('blur', { params: { radius: 0.3,
      mode: 'wire' } }), m('clouds', { id: 'cl4', as: 'input' }), m('counted', { blend: 'max' }),
    m('mask', { input: 'cl4' })], { groups: ['arches', 'spires'], blend: 'over',
    soften: { radius: 0.15, mode: 'wire' } })] },
  '8c6ff599c4d7fe0a3906ae920ee487e97407c3576b23d253c42d05b73176a35c'],
  ['a warp before trails reaches the source after them', { layers: [layer('After trails', [
    m('scroll', { params: { up: 0.4 } }), m('meteors'), m('trails'), m('rising-sweep'), m('sparkle')])] },
  '2d69b1483ebd767cc158f46827e353190808b3c5f3baf2c4039d64b7a92825d8'],
  ['a warp between two sources, the second over', { layers: [layer('Mid over', [m('palette-drift'), m('twist'),
    m('disc', { blend: 'over' })])] },
  '5b17e25a980f62a888363b01701de6be8eb5cbc4c3340888386001730b0bb22b'],
  ['three runs bent differently, two of them shown, then a blur and a mask', { layers: [layer('Runs', [
    m('plasma', { blend: 'max' }), m('rotate', { params: { spin: 0.5 } }), m('disc', { blend: 'over' }),
    m('mirror', { params: { upDown: true } }), m('clouds', { id: 'cl5', as: 'input' }),
    m('blur', { params: { radius: 0.3, mode: 'space' } }), m('mask', { input: 'cl5' }), m('threshold')])] },
  'bba86b6597ef18961ff3f7ed3473974df1fa2b738a88dccbba6769d8d246e5d7'],
  ['a warp between two sources that add', { layers: [layer('Mid add', [m('aurora'), m('kaleidoscope'),
    m('fireworks')])] },
  'a01a2ca369457f2f32c5748eb9b124a6e95cc0e6751844f35973534fcc86c195'],
  ['a warp between a source and a hue shift', { layers: [layer('Mid shift', [m('bars'), m('mirror'),
    m('hue-shift')])] },
  'a592b561dde3d3b3a6582be1b1c0d311c833a35d26a62828e6184a044450409b'],
  ['a warp after a source and a tint, before a source by max', { layers: [layer('Mid tint', [m('clouds'), m('tint'),
    m('rotate', { params: { spin: 0.4 } }), m('lighthouse', { blend: 'max' })])] },
  '9e7e83c29721fa6318aa8cd6f2fed34a3f1e05c8808b8ab6a288e995fe0679bc'],
  ['a warp before a blur and a hue shift by angle', { layers: [layer('Round', [m('twist'), m('galaxy'),
    m('blur', { params: { radius: 0.3, mode: 'space' } }), m('hue-shift', { params: { axis: 3 } })])] },
  '4c0be56085b886dee2488c6e32cef95f7d405d4b8425188b37fb10fc944a4e99'],
  ['a disabled warp leads, an enabled one trails', { layers: [layer('Off', [m('mirror', { enabled: false }),
    m('bars'), m('edge-fade'), m('scroll', { params: { up: 0.5 } })])] },
  '9c890167d11bb80f40e54ba3d3074e47ca3acdc36019038f5993a821d19a13c8'],
];

/** SHA-256 (hex) over a look's first 60 frames of DMX as `core` (a pattern-core) renders them on the Folly. */
export function digest(core, look) {
  const scene = core.prepareScene(folly);
  core.setLibrary([]);
  const layers = look.layers.map((l) => core.prepareLayer(scene, l, core.compileLayer(l)));
  const g = core.prepareLook({ globals: look.globals, automation: look.automation, bpm: look.bpm });
  const rgb = new Float32Array(scene.count * 3), full = new Uint8Array(scene.frameChannels), all = createHash('sha256');
  for (let f = 0; f < 60; f++) {
    const { errors } = core.renderFrame(scene, layers, f / 40, rgb, g);
    if (errors.length) throw new Error(`frame ${f}: ${errors[0].error}`);
    all.update(core.toChannels(scene, rgb, full));
  }
  return all.digest('hex');
}
