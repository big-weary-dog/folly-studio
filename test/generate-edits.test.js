// A refinement's answer as edits (SPEC-generators "Refine"): each op on a decomposed composition, paths that lead
// nowhere named with why, a rewrite, the schema, and the layers a refinement left alone kept as they were stored.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { applyEdits, buildEditsRepairMessage, fieldsOf, keepUntouched } from '../src/generate/edits.ts';
import { compositionSchema } from '../src/generate/composition.ts';
import { GROUPS } from './fixtures/generate/shared.js';

const BASE = Object.freeze({
  title: 'Tide', summary: 'A slow swell', duration: 30,
  layers: [
    { title: 'Bed', groups: ['cathedral'], blend: 'normal', level: 0.6,
      modules: [{ use: 'colour-wash', params: [{ name: 'colours', value: 'body' }] }] },
    { title: 'Rose', groups: ['rose'], blend: 'add', level: 0.8,
      modules: [{ use: 'bars', id: 'm1', params: [{ name: 'speed', value: 0.4 }] }, { use: 'ext:swirl', params: [] }] },
  ],
  extensions: [{ name: 'swirl', kind: 'warp', summary: 's', why: 'w', code: 'function warp(q) {}' }],
});
const FIELDS = fieldsOf(compositionSchema(GROUPS));
const run = (...edits) => applyEdits(BASE, { edits }, FIELDS);

describe('applyEdits', () => {
  test('set: a key, a param\'s value, a param not given yet, a global made on the way, a dotted path', () => {
    const { comp, failed } = run(
      { op: 'set', path: 'layers/Rose/level', value: '0.5' },
      { op: 'set', path: 'layers/Rose/modules/bars/params/speed', value: 0.2 },
      { op: 'set', path: 'layers/Rose/modules/m1/params/bars', value: '6' },
      { op: 'set', path: 'globals/palette', value: '"ember"' },
      { op: 'set', path: 'layers.Bed.groups', value: ['spires'] },
      { op: 'set', path: 'layers/0/modules/0/params/colours', value: 'accent' }, // a bare word is its text
      { op: 'set', path: 'duration', value: '60' });
    assert.deepEqual(failed, []);
    const rose = comp.layers[1];
    assert.equal(rose.level, 0.5);
    assert.deepEqual(rose.modules[0].params, [{ name: 'speed', value: 0.2 }, { name: 'bars', value: 6 }]);
    assert.deepEqual(comp.globals, { palette: 'ember' });
    assert.deepEqual(comp.layers[0].groups, ['spires']);
    assert.deepEqual(comp.layers[0].modules[0].params, [{ name: 'colours', value: 'accent' }]);
    assert.equal(comp.duration, 60);
    assert.equal(BASE.layers[1].level, 0.8, 'the base is never changed');
  });

  test('set: a binding, which has a name of its own, is the param\'s value, never the param', () => {
    const lfo = { mod: 'global', name: 'energy', from: 0.1, to: 0.35 };
    const { comp, failed } = run({ op: 'set', path: 'layers/Rose/modules/bars/params/speed', value: lfo });
    assert.deepEqual(failed, []);
    assert.deepEqual(comp.layers[1].modules[0].params[0], { name: 'speed', value: lfo });
  });

  test('remove, insert: a param back to its default, a module into a chain, an extension by its bare name', () => {
    const { comp, failed } = run(
      { op: 'remove', path: 'layers/Rose/modules/bars/params/speed' },
      { op: 'insert', path: 'layers/Rose/modules', module: { use: 'sparkle', params: [] }, at: 1 },
      { op: 'remove', path: 'layers/Rose/modules/swirl' },
      { op: 'remove', path: 'duration' });
    assert.deepEqual(failed, []);
    assert.deepEqual(comp.layers[1].modules.map((m) => m.use), ['bars', 'sparkle']);
    assert.deepEqual(comp.layers[1].modules[0].params, []);
    assert.equal('duration' in comp, false);
  });

  test('insert: a list the look lacks (macros, automation) is made; a key no look has is not', () => {
    const storm = { name: 'storm', value: 0.2, min: 0, max: 1 }, lane = { name: 'storm', points: [[0, 0.2], [30, 1]] };
    const { comp, failed } = run({ op: 'insert', path: 'globals/macros', value: storm },
      { op: 'insert', path: 'automation', value: lane }, { op: 'insert', path: 'layers/Rose/modlues', value: {} });
    assert.deepEqual(comp.globals, { macros: [storm] });
    assert.deepEqual(comp.automation, [lane]);
    assert.deepEqual(failed, ['edits[2] insert layers/Rose/modlues: layers/Rose/modlues is not a list']);
    assert.equal('modlues' in comp.layers[1], false);
  });

  test('the layer ops: add (on top, or at), move, replace, remove; by title, index or a layers/ path', () => {
    const layer = { title: 'Sparks', groups: ['spires'], blend: 'add', level: 1, modules: [{ use: 'sparkle' }] };
    const top = run({ op: 'add_layer', layer }).comp;
    assert.deepEqual(top.layers.map((l) => l.title), ['Bed', 'Rose', 'Sparks']);
    const { comp, failed } = run({ op: 'add_layer', layer, at: 0 }, { op: 'move_layer', path: 'Rose', at: 0 },
      { op: 'replace_layer', path: 'layers/Bed', layer: { ...layer, title: 'Glow' } },
      { op: 'remove_layer', path: '1' });
    assert.deepEqual(failed, []);
    assert.deepEqual(comp.layers.map((l) => l.title), ['Rose', 'Glow']);
  });

  test('an edit that does not apply is skipped and named with why; the rest apply', () => {
    const { comp, failed } = run({ op: 'set', path: 'layers/Rose/levl', value: '0.1' },
      { op: 'set', path: 'layers/Moon/level', value: '0.1' },
      { op: 'set', path: 'layers/Rose/level', value: '0.3' },
      { op: 'remove_layer', path: 'Moon' }, { op: 'spin', path: 'x' },
      { op: 'set', path: 'layers/Rose/modules/bars/params/speed/value/deeper', value: '1' },
      { op: 'set', path: 'layers/__proto__/polluted', value: '1' },
      { op: 'set', path: '', value: '1' }, { op: 'add_layer' }, { op: 'set', path: 'title' },
      { op: 'set', path: 'layers/Rose/modules/bars/params/speed', value: '{"mod":"lfo"} 前' },
      { op: 'set', path: 'layers/Rose/modules/bars/params/colours', value: '"accent1"},{' });
    assert.equal(comp.layers[1].level, 0.3);
    assert.equal({}.polluted, undefined);
    assert.equal(failed.length, 11, failed.join('\n'));
    assert.match(failed[9], /value is not JSON: \{"mod":"lfo"\} 前/);
    assert.deepEqual(comp.layers[1].modules[0].params, [{ name: 'speed', value: 0.4 }], 'a broken value sets nothing');
    assert.equal(failed[0], 'edits[0] set layers/Rose/levl: levl is not a field of a look');
    assert.match(failed[1], /no Moon in layers \(it has Bed, Rose\)/);
    assert.match(failed[2], /no layer Moon/);
    assert.match(failed[3], /unknown op spin/);
    assert.match(buildEditsRepairMessage(failed), /- edits\[0\] set layers\/Rose\/levl/);
  });

  test('a rewrite, or a whole composition, is the answer as it is; nothing is no change', () => {
    const rewrite = { ...BASE, title: 'Storm', layers: [BASE.layers[0]] };
    assert.equal(applyEdits(BASE, { rewrite }).comp, rewrite);
    assert.equal(applyEdits(BASE, rewrite).comp, rewrite);
    assert.deepEqual(applyEdits(BASE, { edits: [] }).comp, BASE);
    const empty = applyEdits(BASE, null);
    assert.deepEqual(empty, { comp: BASE, failed: ['no edits and no rewrite: the answer changes nothing'] },
      'an empty answer goes back for repair');
    const many = Array.from({ length: 41 }, () => ({ op: 'remove', path: 'nothing' }));
    assert.match(run(...many).failed[0], /only the first 40/);
  });
});

describe('keepUntouched', () => {
  test('a layer the answer left as it was is the stored layer again, byte for byte; a changed one is new', () => {
    const stored = [{ id: 'a', title: 'Bed', soften: 0.2 }, { id: 'b', title: 'Rose' }];
    const after = run({ op: 'set', path: 'layers/Rose/level', value: '0.5' }).comp;
    const made = [{ id: 'x', title: 'Bed' }, { id: 'y', title: 'Rose' }];
    const kept = keepUntouched(stored, BASE, after, made);
    assert.equal(kept[0], stored[0]);
    assert.equal(kept[1], made[1]);
    const moved = run({ op: 'move_layer', path: 'Rose', at: 0 }).comp;
    assert.deepEqual(keepUntouched(stored, BASE, moved, made), [stored[1], stored[0]]);
    assert.equal(keepUntouched(stored, BASE, { layers: [] }, made), made, 'a layer dropped on the way: as made');
  });
});
