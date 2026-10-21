// Looks from before the one rule (a warp bent the modules after it), in their old order, each with the SHA-256 of its
// first 60 DMX frames (t = f / 40, default gamma, the Folly) as the engine of 328a218 rendered them (3e681e0, its rule
// with colour picks, for the last two, and the same bytes for the rest), with the library as of 11a4627
// (library-v1.json, pinned so that library edits leave these frames alone) and this tree's rig and palettes. Re-made
// when a r moved to the LEDs' mean (the effects audit's core fix), and when add and blur moved to light (each a
// deliberate change of the frames): the recipe below then needs that commit's core.
// test/chain-order.test.js converts each look and renders the same bytes. To make the digests again (from studio/; the
// old core is plain modules, so a copy of public/js is enough):
//   mkdir -p /tmp/v1 && git archive 3e681e0 public/js | tar -x -C /tmp/v1
//   node --input-type=module -e 'const f = await import("./test/fixtures/chains-v1.js");
//     const core = await import("/tmp/v1/public/js/pattern-core.ts");
//     for (const [name, look] of f.LOOKS) console.log(f.digest(core, look), name);'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { folly } from './rigs.js';

const read = (p) => readFileSync(new URL(`../../public/${p}`, import.meta.url), 'utf8');
const LIB = JSON.parse(readFileSync(new URL('./library-v1.json', import.meta.url), 'utf8'));
const pal = (name) => JSON.parse(read('data/palettes.json')).palettes.find((p) => p.name === name);
const OWN = {
  counted: 'let calls = 0;\nfunction frame() { calls++; }\nfunction pixel(p) { return [p.lz, calls % 7 / 7, p.ly]; }\n',
  // A disc whose alpha falls off with r and turns with a: what is under it shows through.
  disc: 'function pixel(p, t) {\n  const a = smoothstep(0.75, 0.25, p.r) * (0.5 + 0.5 * sin(TAU * (3 * p.a - t)));\n'
    + '  return [0.9, 0.3 + 0.5 * p.a, 0.1, a];\n}\n',
};
let n = 0;
/** Library module `name` (or one of OWN), with `extra` fields. */
const m = (name, extra = {}) => ({ id: extra.id ?? `m${++n}`, kind: OWN[name] ? 'source' : LIB[name].kind,
  title: name, ...(OWN[name] ? {} : { ref: name }), code: OWN[name] ?? LIB[name].code, params: {}, ...extra });
const layer = (title, modules, extra = {}) => ({ id: `l${++n}`, title, groups: ['cathedral'], blend: 'add', level: 1,
  modules, ...extra });

/** [name, look, digest] */
export const LOOKS = [
  ['the perf demo: twist, meteors, clouds as input, mask', { layers: [layer('Storm', [m('twist', { id: 'w' }),
    m('meteors', { id: 'met' }), m('clouds', { id: 'cl', as: 'input' }), m('mask', { id: 'k', input: 'cl' })])],
  globals: { palette: pal('carnival'), energy: 0.7, hue: 0.05, macros: { storm: { value: 0.4, min: 0, max: 1 } } },
  automation: { storm: [[0, 0], [30, 1]] } },
  '1fbe460d4fa89022298c113a955d43ebc22881f92bc31ba34b5fa2813ac8da2e'],
  ['three warps lead plasma and four filters', { layers: [layer('Long', [m('radial-repeat'), m('mosaic'),
    m('rotate', { params: { spin: 0.3 } }), m('plasma'), m('gradient-map'), m('hue-shift'), m('sparkle'),
    m('edge-fade')], { groups: undefined })] },
  '49ea7175032290b5b2a086869c3fd1f535a4ad08e456f23c52aa200e692fce25'],
  ['four warps lead meteors masked by clouds, then trails', { layers: [layer('Trails', [m('mirror'),
    m('kaleidoscope'), m('scroll'), m('twist'), m('meteors', { id: 'met2' }), m('clouds', { id: 'cl2', as: 'input' }),
    m('mask', { input: 'cl2' }), m('trails')])] },
  '4815ebbae6af590702478fcc28e4d77c0f1bf889fa3e66b7925da12afe00a182'],
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
  '8fff31cb7bacac71da708795a2389d472c865600b039f5e549aa5710769fb688'],
  ['a warp before trails reaches the source after them', { layers: [layer('After trails', [
    m('scroll', { params: { up: 0.4 } }), m('meteors'), m('trails'), m('rising-sweep'), m('sparkle')])] },
  'd5a55f58820628fe9a975459aa53146641ac340c62b3107bd750340f48d9d3b2'],
  ['a warp between two sources, the second over', { layers: [layer('Mid over', [m('palette-drift'), m('twist'),
    m('disc', { blend: 'over' })])] },
  '1052693c66eaa83ad97b23bc3ba3145ba495a8f8f6ed46c61a1bf9b8b68bb5bc'],
  ['three runs bent differently, two of them shown, then a blur and a mask', { layers: [layer('Runs', [
    m('plasma', { blend: 'max' }), m('rotate', { params: { spin: 0.5 } }), m('disc', { blend: 'over' }),
    m('mirror', { params: { upDown: true } }), m('clouds', { id: 'cl5', as: 'input' }),
    m('blur', { params: { radius: 0.3, mode: 'space' } }), m('mask', { input: 'cl5' }), m('threshold')])] },
  '3e021292acd668771f10a958b391c6dda44b57927dd9edc068a7bb55b3b7301d'],
  ['a warp between two sources that add', { layers: [layer('Mid add', [m('aurora'), m('kaleidoscope'),
    m('fireworks')])] },
  'ec0725093da567ac95e17e993ac030d3ce56763b3e65d23fc1d599917a9b2e71'],
  ['a warp between a source and a hue shift', { layers: [layer('Mid shift', [m('bars'), m('mirror'),
    m('hue-shift')])] },
  'a592b561dde3d3b3a6582be1b1c0d311c833a35d26a62828e6184a044450409b'],
  ['a warp after a source and a tint, before a source by max', { layers: [layer('Mid tint', [m('clouds'), m('tint'),
    m('rotate', { params: { spin: 0.4 } }), m('lighthouse', { blend: 'max' })])] },
  '9e7e83c29721fa6318aa8cd6f2fed34a3f1e05c8808b8ab6a288e995fe0679bc'],
  ['a warp before a blur and a hue shift by angle', { layers: [layer('Round', [m('twist'), m('galaxy'),
    m('blur', { params: { radius: 0.3, mode: 'space' } }), m('hue-shift', { params: { axis: 3 } })])] },
  '7f5808d9a7f9ff0fa73dc427560ce48bd32feaa528288e0812b55a1934056f06'],
  ['a disabled warp leads, an enabled one trails', { layers: [layer('Off', [m('mirror', { enabled: false }),
    m('bars'), m('edge-fade'), m('scroll', { params: { up: 0.5 } })])] },
  '9c890167d11bb80f40e54ba3d3074e47ca3acdc36019038f5993a821d19a13c8'],
  ['picks, a warp before them', { layers: [layer('Picks', [m('twist'),
    m('meteors', { params: { sky: 'low', color: { pick: 'body/accent', rotate: 0.25 }, head: 'high' } }),
    m('hue-shift')])],
  globals: { palette: pal('carnival') } },
  '7758f8b0b0dcc14998ceafcef6f0edd9f35274ac2fbe68fba589aa7397278f11'],
  ['a pick turned by beats, two sources bent differently', { bpm: 120, layers: [layer('Turning', [
    m('clouds', { params: { sky: 'low', cloud: 'body' } }), m('rotate', { params: { spin: 0.3 } }),
    m('lighthouse', { blend: 'max', params: { beam: { pick: 'accent/high', rotate: { mod: 'lfo', rate: 1,
      unit: 'beats' } } } })])] },
  '938076239d3a9b5b532ecb66b7ed1c1a82874d5aa46e926a8e68a701a2a56ca3'],
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
