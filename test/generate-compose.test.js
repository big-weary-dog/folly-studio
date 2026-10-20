// src/generate/ composing from the library: the catalog (params read statically), the composition's schema, expand
// (refs, presets, overrides, extensions, errors) and the queue's one repair round inside an idea.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { describe, test } from 'vitest';

import { buildCatalog, readParams } from '../src/generate/catalog.ts';
import { strictSchema } from '../src/generate/codex.ts';
import { compositionSchema } from '../src/generate/composition.ts';
import { expand } from '../src/generate/expand.ts';
import { createQueue } from '../src/generate/index.ts';
import { buildSystemPrompt } from '../src/generate/prompt.ts';
import { validateLook } from '../shared/schemas/generated.ts';
import { GROUPS, queueSetup, RIG, STUDIO } from './fixtures/generate/shared.js';

const DIR = path.join(STUDIO, 'public/patterns');
const REAL = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')).map((p) => ({ ...p,
  code: p.kind === 'preset' ? '' : fs.readFileSync(path.join(DIR, `${p.name}.js`), 'utf8') }));
const CATALOG = buildCatalog(REAL);
const layer = (extra) => ({ title: 'L', groups: ['cathedral'], blend: 'add', level: 1, ...extra });
const answer = (layers, extra = {}) => ({ title: 'T', summary: 'S', layers, ...extra });

describe('catalog', () => {
  test('every library module\'s params read statically, as many as it declares', () => {
    for (const m of REAL.filter((p) => p.kind !== 'preset')) {
      const declared = /\bconst\s+params\s*=\s*\{([\s\S]*?)\n\};/.exec(m.code)?.[1] ?? '';
      const names = declared.match(/^\s{2}[A-Za-z_]\w*\s*:/gm) ?? [];
      assert.equal(Object.keys(readParams(m.code)).length, names.length, m.name);
    }
    assert.deepEqual(readParams('const params = { speed: { value: Math.PI, min: 0, max: 4 } };'), {});
    assert.deepEqual(readParams('function pixel() {}'), {});
  });

  test('sorted, every module and preset named, and the same bytes each time', () => {
    const names = [...CATALOG.modules.keys()];
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    assert.equal(CATALOG.modules.size + CATALOG.presets.size, REAL.length);
    assert.equal(buildCatalog([...REAL].reverse()).text, CATALOG.text);
    assert.match(CATALOG.text, /^Sources \(each also has brightness 0–1 \(1\)\):\n/, 'Brightness said once');
    assert.match(CATALOG.text,
      /\n- bars: [^\n]+ \[colours colour \(all\); direction up\|down[a-z|-]* \(up\); speed -2–2 \(0\.4\);/,
      'its params, each with its range or choices and default');
    assert.equal(buildCatalog(REAL, new Map([['bars', 'Stripes.']])).text.match(/\n- bars: (\S+)/)?.[1], 'Stripes.',
      'its line from the docs');
    assert.match(CATALOG.text, /\n- starfield: colour-wash → clouds → sparkle — /);
  });

  test('the composition schema names presets and closes every object, strict too', () => {
    const schema = compositionSchema(GROUPS, CATALOG);
    const l = schema.properties.layers.items;
    assert.deepEqual(l.properties.preset.enum, [...CATALOG.presets.keys()]);
    assert.deepEqual(l.properties.modules.items.required, ['use']);
    const check = (node) => {
      if (Array.isArray(node)) return node.forEach(check);
      if (!node || typeof node !== 'object') return undefined;
      if (node.type === 'object' && node.properties) {
        assert.deepEqual(node.required, Object.keys(node.properties));
        assert.equal(node.additionalProperties, false);
      }
      return Object.values(node).forEach(check);
    };
    check(strictSchema(schema));
  });
});

describe('worked compositions', () => {
  test('an example placed on a tag shows only on a rig that has it; the rest place on its root', () => {
    const sys = buildSystemPrompt({ library: REAL, rig: RIG });
    for (const t of ['"preset":"rain"', '"direction","value":"clockwise"', '"input":"sky"']) {
      assert.ok(sys.includes(t), t);
    }
    // A rig with none of the Folly's places (City of Gods drops canopy, wash, flood and back; here rose and spire too).
    const bare = GROUPS.map((g) => ({ ...g, tags: (g.tags ?? []).filter((t) => !/^(rose|spire|canopy|wash|flood|back)/
      .test(t)) }));
    const other = buildSystemPrompt({ library: REAL, rig: { ...RIG, groups: bare }, groups: bare });
    assert.ok(other.includes('"preset":"rain"') && !other.includes('"input":"sky"'));
    assert.ok(!/canopy|"wash"|flood/.test(other.slice(other.indexOf('# Worked compositions'))));
  });
});

describe('expand', () => {
  test('a chain of library modules gets their code, params held to their declarations', () => {
    const x = expand(answer([layer({ modules: [
      { use: 'bars', params: [{ name: 'speed', value: 9 }, { name: 'profile', value: 'comet' },
        { name: 'nope', value: 1 }, { name: 'direction', value: 'clockwise' }] },
      { use: 'bars', params: [{ name: 'speed', value: { mod: 'global', name: 'energy' } }] },
    ] })]), CATALOG);
    assert.deepEqual(x.errors, []);
    const [a, b] = x.look.layers[0].modules;
    assert.equal(a.code, CATALOG.modules.get('bars').code);
    assert.deepEqual(a.params, { speed: 2, profile: 'comet', direction: 'clockwise' });
    assert.equal(b.id, 'bars-2');
    assert.deepEqual(b.params.speed, { mod: 'global', name: 'energy' });
    assert.ok(x.notes.some((n) => /9 held to -2\.\.2/.test(n)) && x.notes.some((n) => /no such param/.test(n)));
    assert.deepEqual(x.uses, { library: 2, extensions: 0, code: 0 });
    const look = validateLook(x.look, { groups: GROUPS });
    assert.equal(look.layers[0].modules.length, 2);
  });

  test('round and orbit, from before both ways were named, are read as their new words with a note', () => {
    const x = expand(answer([layer({ modules: [
      { use: 'bars', params: [{ name: 'direction', value: 'round' }] },
      { use: 'bars', params: [{ name: 'direction', value: 'orbit' }] },
      { use: 'scroll', params: [{ name: 'direction', value: 'orbit' }] },
    ] })]), CATALOG);
    assert.deepEqual(x.errors, []);
    assert.deepEqual(x.look.layers[0].modules.map((m) => m.params.direction), ['clockwise', 'orbit-counterclockwise',
      undefined], 'scroll has no orbit');
    assert.ok(x.notes.some((n) => /round is now clockwise/.test(n)));
    assert.ok(x.notes.some((n) => /orbit is not one of/.test(n)));
  });

  test('a preset becomes its layers, overrides on top, its palette where the look has none', () => {
    const preset = CATALOG.presets.get('starfield');
    const x = expand(answer([layer({ preset: 'starfield', overrides: [{ module: 'sparkle', name: 'density',
      value: 0.5 }] })]), CATALOG);
    assert.deepEqual(x.errors, []);
    const mods = x.look.layers.flatMap((l) => l.modules);
    assert.deepEqual(mods.map((m) => m.ref), preset.layers.flatMap((l) => l.modules.map((m) => m.ref)));
    const sparkle = mods.find((m) => m.ref === 'sparkle');
    if ('density' in CATALOG.modules.get('sparkle').params) assert.equal(sparkle.params.density, 0.5);
    const bad = expand(answer([layer({ preset: 'starfield', overrides: [{ module: 'fire', name: 'x', value: 1 }] })]),
      CATALOG);
    assert.match(bad.errors[0].message, /starfield has no module fire \(it has /);
  });

  test('what the model can fix is an error with a path and a hint', () => {
    const x = expand(answer([
      layer({ modules: [{ use: 'barz' }, { use: 'starfield' }, { use: 'ext:glow' }, { use: 'mask', input: 'sky' }] }),
      layer({ preset: 'bars' }), layer({}),
    ]), CATALOG);
    const by = Object.fromEntries(x.errors.map((e) => [e.path, e]));
    assert.match(by['layers[0].modules[0].use'].message, /did you mean bars\?/);
    assert.match(by['layers[0].modules[1].use'].message, /is a preset/);
    assert.equal(by['layers[0].modules[2].use'].code, 'unknown_extension');
    assert.equal(by['layers[0].modules[3].input'].code, 'bad_input');
    assert.match(by['layers[1].preset'].message, /is a module/);
    assert.equal(by['layers[2]'].code, 'empty_layer');
  });

  test('an extension is used by name; the old shape (code) passes through', () => {
    const code = 'const params = {};\nfunction pixel(p, t, P) { return [1, 0, 0, 1]; }';
    const given = answer([layer({ modules: [{ use: 'ext:red', params: [] }] }), layer({ code }),
      layer({ modules: [{ code }, { code }] })], { extensions: [
      { name: 'red', kind: 'source', summary: 'Red', why: 'nothing is plain red', code }] });
    const before = structuredClone(given), x = expand(given, CATALOG);
    assert.deepEqual(given, before, 'the answer is left as the model wrote it, for a repair turn');
    assert.deepEqual(x.errors, []);
    assert.equal(x.look.layers[0].modules[0].code, code);
    assert.equal(x.look.layers[1].code, code);
    assert.deepEqual(x.uses, { library: 0, extensions: 1, code: 3 });
    assert.deepEqual(x.look.layers[2].modules.map((m) => m.id), ['m', 'm-2']);
    const bad = expand(answer([], { extensions: [{ name: 'x', kind: 'filter', code }] }), CATALOG);
    assert.match(bad.errors[0].message, /defines function filter/);
  });
});

describe('queue', () => {
  test('one repair round inside the idea, then the look; a second miss keeps what was usable', async () => {
    const asks = [];
    const claude = async (ctx) => {
      asks.push(ctx.repair);
      const use = ctx.repair ? 'bars' : 'barz';
      return answer([layer({ modules: [{ use }] }), layer({ modules: [{ use: 'colour-wash' }] })]);
    };
    const { store, idea, queue } = queueSetup(createQueue, { adapterName: 'claude', adapters: { claude },
      loadLibrary: () => REAL });
    const i = idea('a chase');
    queue.enqueue(i);
    await queue.idle();
    assert.equal(asks.length, 2);
    assert.match(asks[1].errors[0].message, /did you mean bars/);
    const done = store.ideas.get(i.id);
    assert.equal(done.status, 'ready', done.error);
    assert.deepEqual(store.looks.get(done.lookId).layers.map((l) => l.modules[0].ref), ['bars', 'colour-wash']);

    const stubborn = async () => answer([layer({ modules: [{ use: 'barz' }] }), layer({ modules: [{ use: 'bars' }] })]);
    const s = queueSetup(createQueue, { adapterName: 'claude', adapters: { claude: stubborn },
      loadLibrary: () => REAL });
    const j = s.idea('a chase');
    s.queue.enqueue(j);
    await s.queue.idle();
    const kept = s.store.looks.get(s.store.ideas.get(j.id).lookId);
    assert.deepEqual(kept.layers.map((l) => l.modules[0].ref), ['bars']);
  });

  test('the saved look keeps the bpm and a modulator the composition gave', async () => {
    const breath = { mod: 'lfo', shape: 'sine', rate: 0.25, unit: 'beats', center: 0.5, depth: 0.5 };
    const claude = async () => answer([layer({ modules: [{ use: 'colour-wash', params: [{ name: 'brightness',
      value: { mod: 'global', name: 'breath', from: 0.2, to: 0.6 } }] }] })],
    { bpm: 100, globals: { macros: [{ name: 'breath', value: 0.5, min: 0, max: 1, mod: breath }] } });
    const { store, idea, queue } = queueSetup(createQueue, { adapterName: 'claude', adapters: { claude },
      loadLibrary: () => REAL });
    const i = idea('everything breathes at 100 bpm');
    queue.enqueue(i);
    await queue.idle();
    const look = store.looks.get(store.ideas.get(i.id).lookId);
    assert.equal(look.bpm, 100);
    assert.deepEqual(look.globals.macros.breath.mod, breath);
  });
});
