// Presets (SPEC "Library"): recipes of library modules in index.json, checked by the shared schema, loaded with the
// library (one that names a module the library lacks is dropped), made into the Studio's layers (fresh ids, inputs
// followed, the globals they need merged), rendering cleanly on the Folly and the mini rig, played equal to sought.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, test } from 'vitest';

import { compileLayer, prepareLayer, prepareLook, prepareScene, renderFrame } from '../public/js/pattern-core.ts';
import { presetLayers, withPresetGlobals } from '../public/js/ui/model.ts';
import { LibraryEntry, type ModuleEntry, Preset, type PresetEntry } from '../shared/schemas/rig.ts';
import { createLoaders } from '../src/static.ts';
import { folly, mini } from './fixtures/rigs.js';

const here = (p: string) => new URL(p, import.meta.url);
const index = JSON.parse(readFileSync(here('../public/patterns/index.json'), 'utf8')) as { name: string,
  kind: string }[];
const library = index.map((e) => LibraryEntry.parse(e)).map((e) => ({ ...e, code: e.kind === 'preset' ? ''
  : readFileSync(here(`../public/patterns/${e.name}.js`), 'utf8') })) as (ModuleEntry | PresetEntry)[];
const presets = library.filter((e): e is PresetEntry => e.kind === 'preset');
const quiet = { warn() {}, error() {} };

describe('the schema', () => {
  const ok = { name: 'p', title: 'P', summary: 'A preset.', tags: ['x'], category: 'beds', kind: 'preset',
    layers: [{ modules: [{ ref: 'bars', params: { speed: { mod: 'lfo', shape: 'hold' }, colours: 'accent' } }] }] };
  test('takes a recipe of layers of modules by ref, with params, blends, inputs and globals', () => {
    assert.ok(Preset.safeParse(ok).success);
    assert.ok(Preset.safeParse({ ...ok, globals: { macros: { storm: { value: 0.5 } } }, layers: [{ blend: 'over',
      level: 0.8, soften: { radius: 0.2 }, modules: [{ ref: 'clouds', id: 'c', as: 'input' },
        { ref: 'mask', input: 'c' }] }] }).success);
  });
  test('refuses what it cannot play, and never reads a malformed preset as a source', () => {
    for (const bad of [{ layers: [] }, { layers: [{ modules: [{ ref: 'Bad Ref!' }] }] },
      { layers: [{ modules: [{ ref: 'mask', input: 'nowhere' }] }] },
      { layers: [{ modules: [{ ref: 'x', code: '' }] }] },
      { layers: [{ modules: [{ ref: 'x' }], groups: ['all'] }] }]) {
      assert.equal(Preset.safeParse({ ...ok, ...bad }).success, false, JSON.stringify(bad));
      assert.equal(LibraryEntry.safeParse({ ...ok, ...bad }).success, false, 'dropped, not a source');
    }
  });
});

test('the library\'s presets parse, name its modules, and the loader drops one that names a module it lacks', () => {
  assert.ok(presets.length >= 4, `${presets.length} presets`);
  const names = new Set(library.filter((e) => e.kind !== 'preset').map((e) => e.name));
  for (const p of presets) for (const l of p.layers) for (const m of l.modules) assert.ok(names.has(m.ref), m.ref);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'presets-')), lib = path.join(dir, 'patterns');
  mkdirSync(lib);
  writeFileSync(path.join(lib, 'one.js'), 'function pixel() { return 1; }\n');
  const raw = index.find((e) => e.kind === 'preset');
  writeFileSync(path.join(lib, 'index.json'), JSON.stringify([{ name: 'one', kind: 'source' },
    { ...raw, name: 'good', layers: [{ modules: [{ ref: 'one' }] }] },
    { ...raw, name: 'lost', layers: [{ modules: [{ ref: 'gone' }] }] }]));
  const got = createLoaders(dir, { log: quiet as never }).loadLibrary();
  assert.deepEqual(got.map((e) => [e.name, e.kind, e.code.length > 0]), [['one', 'source', true],
    ['good', 'preset', false]]);
});

describe('in the Studio', () => {
  test('a preset\'s layers: the library\'s modules with its params and blends, fresh ids, inputs followed', () => {
    const recipe: PresetEntry = { ...presets[0], title: 'Masked', layers: [{ level: 0.7, modules: [
      { ref: 'clouds', id: 'c', as: 'input' }, { ref: 'bars', params: { bars: 3 }, blend: 'over' },
      { ref: 'mask', input: 'c' }] }] };
    const [layer] = presetLayers(recipe, library, folly)!;
    assert.deepEqual(layer.modules.map((m) => [m.ref, m.kind, m.blend, m.as]), [['clouds', 'source', undefined,
      'input'], ['bars', 'source', 'over', undefined], ['mask', 'filter', undefined, undefined]]);
    assert.equal(layer.modules[2].input, layer.modules[0].id, 'the mask reads the clouds by their new id');
    assert.notEqual(layer.modules[0].id, 'c');
    assert.deepEqual(layer.modules[1].params, { bars: 3 });
    assert.equal(layer.modules[1].code, library.find((e) => e.name === 'bars')!.code);
    assert.deepEqual([layer.title, layer.level, layer.groups], ['Masked', 0.7, ['cathedral']]);
    assert.equal(presetLayers({ ...recipe, layers: [{ modules: [{ ref: 'gone' }] }] }, library, folly), null);
  });

  test('the globals it needs: its macros the look lacks, its palette only where the look has none', () => {
    const p = { ...presets[0], globals: { palette: 'vapour' as never, macros: { storm: { value: 0.2, min: 0, max: 1 },
      glow: { value: 1, min: 0, max: 1 } } } };
    assert.deepEqual(withPresetGlobals({ energy: 0.7, macros: { storm: { value: 0.9, min: 0, max: 1 } } }, p), {
      energy: 0.7, palette: 'vapour', macros: { storm: { value: 0.9, min: 0, max: 1 }, glow: { value: 1, min: 0,
        max: 1 } } });
    assert.equal(withPresetGlobals({ palette: { name: 'mine' } } as never, p)!.palette!.name, 'mine');
    assert.deepEqual(withPresetGlobals({ energy: 1 }, presets[1]), { energy: 1 }, 'none needed: the look as it was');
  });
});

for (const [rigName, rig] of Object.entries({ folly, mini })) {
  test(`every preset renders cleanly on the ${rigName} rig, played equal to sought`, () => {
    const scene = prepareScene(rig);
    for (const p of presets) {
      const make = () => presetLayers(p, library, rig)!.map((l) => prepareLayer(scene, l, compileLayer(l)));
      const played = make(), look = prepareLook(null), rgb = new Float32Array(scene.count * 3);
      let lit = 0;
      for (let f = 0; f <= 80; f++) {
        const { errors } = renderFrame(scene, played, f / 40, rgb, look);
        assert.deepEqual(errors, [], `${p.name} at frame ${f}`);
      }
      for (const v of rgb) {
        assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, p.name);
        if (v > 0.05) lit++;
      }
      assert.ok(lit > rgb.length * 0.05, `${p.name}: lit (${lit})`);
      const sought = renderFrame(scene, make(), 2, new Float32Array(scene.count * 3), prepareLook(null)).rgb;
      assert.deepEqual(rgb, sought, `${p.name}: played and sought`);
    }
  });
}
