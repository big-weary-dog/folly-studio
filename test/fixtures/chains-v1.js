// Looks from before the one rule (a warp bent the modules after it), in their old order, each with the SHA-256 of its
// first 60 DMX frames (t = f / 40, default gamma, the Folly) as the engine of 328a218 rendered them (3e681e0, its rule
// with colour picks, for the last two, and the same bytes for the rest), with the library as of 11a4627
// (library-v1.json, pinned so that library edits leave these frames alone) and this tree's rig and palettes. Re-made
// when a r moved to the LEDs' mean (the effects audit's core fix), when add and blur moved to light, and when colour
// fades moved to OKLab (each a deliberate change of the frames): the recipe below then needs that commit's core. The
// perf demo's was re-made by this tree's core when the look's hue grade went (it had hue 0.05).
// test/chain-order.test.js converts each look and renders the same bytes. To make the digests again (from the repo
// root; the old core is plain modules, so a copy of public/js is enough):
//   mkdir -p /tmp/v1 && git -C "$SHOW_BUILDER_DIR" archive 3e681e0:studio public/js | tar -x -C /tmp/v1
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
  'b9282fa767e99614db44372d55cd338bc850c153626b58f5b43b5cd1f94ca941'],
  ['three warps lead plasma and four filters', { layers: [layer('Long', [m('radial-repeat'), m('mosaic'),
    m('rotate', { params: { spin: 0.3 } }), m('plasma'), m('gradient-map'), m('hue-shift'), m('sparkle'),
    m('edge-fade')], { groups: undefined })] },
  '9ac6ad574056cfeb82f18f0c67b60c83391618b3e6ac75ab2fac37361cf3612e'],
  ['four warps lead meteors masked by clouds, then trails', { layers: [layer('Trails', [m('mirror'),
    m('kaleidoscope'), m('scroll'), m('twist'), m('meteors', { id: 'met2' }), m('clouds', { id: 'cl2', as: 'input' }),
    m('mask', { input: 'cl2' }), m('trails')])] },
  '02d90ecb15ef98d8222f87be328f263254da559e4f437985565f731600889f38'],
  ['a composed look: mirror, meteors, a bound mask, tint, over a bed', { layers: [layer('Bed', [m('palette-drift')]),
    layer('Composed', [m('mirror', { params: { along: true } }), m('meteors', { id: 'met3' }),
      m('clouds', { id: 'cl3', as: 'input' }), m('mask', { input: 'cl3',
        params: { cutoff: { mod: 'global', name: 'energy', from: 0.6, to: 0.2 } } }), m('tint')],
    { blend: 'over', level: 0.8, clips: [{ start: 0.2, end: 1.2, fadeIn: 0.3, fadeOut: 0.3 }] })],
  globals: { energy: 0.4, palette: pal('chapel'), macros: { storm: { value: 0.5, min: 0, max: 1 } } },
  automation: { energy: [[0, 0.2], [1, 1]] } },
  '11e34fa00c3d3ff3c2231de08a7f7634e48b920c807817d60ab772143fbe1a56'],
  ['a warp before a blur reaches the stage after it; soften', { layers: [layer('Staged', [
    m('mirror', { params: { along: true } }), m('meteors', { id: 'met4' }), m('blur', { params: { radius: 0.3,
      mode: 'wire' } }), m('clouds', { id: 'cl4', as: 'input' }), m('counted', { blend: 'max' }),
    m('mask', { input: 'cl4' })], { groups: ['arches', 'spires'], blend: 'over',
    soften: { radius: 0.15, mode: 'wire' } })] },
  'c77e623ce6d80233e332200f02337fc25e249e74436f9e15349a599606e26a9e'],
  ['a warp before trails reaches the source after them', { layers: [layer('After trails', [
    m('scroll', { params: { up: 0.4 } }), m('meteors'), m('trails'), m('rising-sweep'), m('sparkle')])] },
  'e4ff0b0707b305ed99ff88a1094aa3ac66dd3afd5b8eb63b21ab6d1ee6e6dcd8'],
  ['a warp between two sources, the second over', { layers: [layer('Mid over', [m('palette-drift'), m('twist'),
    m('disc', { blend: 'over' })])] },
  '1052693c66eaa83ad97b23bc3ba3145ba495a8f8f6ed46c61a1bf9b8b68bb5bc'],
  ['three runs bent differently, two of them shown, then a blur and a mask', { layers: [layer('Runs', [
    m('plasma', { blend: 'max' }), m('rotate', { params: { spin: 0.5 } }), m('disc', { blend: 'over' }),
    m('mirror', { params: { upDown: true } }), m('clouds', { id: 'cl5', as: 'input' }),
    m('blur', { params: { radius: 0.3, mode: 'space' } }), m('mask', { input: 'cl5' }), m('threshold')])] },
  '40c8801e3697b00cd97446d70eb87f8548516ce36553de33717ea267b99b4eb0'],
  ['a warp between two sources that add', { layers: [layer('Mid add', [m('aurora'), m('kaleidoscope'),
    m('fireworks')])] },
  'a5bed91877df54b8f96e8d05bbe2d42aae863b9069a57a7ab04f8174014ae1d3'],
  ['a warp between a source and a hue shift', { layers: [layer('Mid shift', [m('bars'), m('mirror'),
    m('hue-shift')])] },
  '5a6a4257701261beef2f1e6c75d50b2050fa45b94878bc2010a258b4d7640be1'],
  ['a warp after a source and a tint, before a source by max', { layers: [layer('Mid tint', [m('clouds'), m('tint'),
    m('rotate', { params: { spin: 0.4 } }), m('lighthouse', { blend: 'max' })])] },
  '5d984bec184429af91c38450c9f00b3f2491ece722a7be4f03d057456710fef8'],
  ['a warp before a blur and a hue shift by angle', { layers: [layer('Round', [m('twist'), m('galaxy'),
    m('blur', { params: { radius: 0.3, mode: 'space' } }), m('hue-shift', { params: { axis: 3 } })])] },
  'fb5363f42e97c057e205fa582c0e51627528ebdf8dd4b193f13f4c901a030ac9'],
  ['a disabled warp leads, an enabled one trails', { layers: [layer('Off', [m('mirror', { enabled: false }),
    m('bars'), m('edge-fade'), m('scroll', { params: { up: 0.5 } })])] },
  '7bd7c020546bdc7352149b5b5f4786347f0dadf76925a8ae789f7726df6963ce'],
  ['picks, a warp before them', { layers: [layer('Picks', [m('twist'),
    m('meteors', { params: { sky: 'low', color: { pick: 'body/accent', rotate: 0.25 }, head: 'high' } }),
    m('hue-shift')])],
  globals: { palette: pal('carnival') } },
  '38e4667326e673e1073bd503a6a4617cab4864a4f9fef7bca63c3b1ee8090ad4'],
  ['a pick turned by beats, two sources bent differently', { bpm: 120, layers: [layer('Turning', [
    m('clouds', { params: { sky: 'low', cloud: 'body' } }), m('rotate', { params: { spin: 0.3 } }),
    m('lighthouse', { blend: 'max', params: { beam: { pick: 'accent/high', rotate: { mod: 'lfo', rate: 1,
      unit: 'beats' } } } })])] },
  '6c62ee460e949e9437f9079907213daa4769aee6603b7237332ff11f396e8c56'],
];

/** SHA-256 (hex) over a look's first 60 frames of DMX as `core` (a pattern-core) renders them on the Folly. */
export function digest(core, look) {
  const scene = core.prepareScene(folly);
  core.setLibrary([]);
  const layers = look.layers.map((l) => core.prepareLayer(scene, l, core.compileLayer(l)));
  const g = core.prepareLook({ globals: look.globals, automation: look.automation, bpm: look.bpm,
    layers: look.layers });
  const rgb = new Float32Array(scene.count * 3), full = new Uint8Array(scene.frameChannels), all = createHash('sha256');
  for (let f = 0; f < 60; f++) {
    const { errors } = core.renderFrame(scene, layers, f / 40, rgb, g);
    if (errors.length) throw new Error(`frame ${f}: ${errors[0].error}`);
    all.update(core.toChannels(scene, rgb, full));
  }
  return all.digest('hex');
}
