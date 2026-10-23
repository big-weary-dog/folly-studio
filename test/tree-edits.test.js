// Whole-look editor operations reach every Composite chain and leave snapshots intact for Undo.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { flatModules } from '../public/js/core/tree.ts';
import { automationEdit } from '../public/js/ui/automation-edit.ts';
import { renameMacro } from '../public/js/ui/look-globals-edit.ts';
import { macroUses } from '../public/js/ui/mod-uses.ts';
import { makeLayer } from '../public/js/ui/model.ts';
import { Globals, Layers } from '../shared/schemas/look.ts';

const binding = { mod: 'global', name: 'storm', from: 0, to: 1 };
const lfo = { mod: 'lfo', rate: 1, center: 0.5, depth: 0.5, amount: 'storm', pace: 'storm' };
const source = (id, params = {}) => ({ id, title: id, kind: 'source', code: 'function pixel() { return [1,0,0]; }',
  params });
const composite = (id, modules) => ({ id, title: id, kind: 'composite', code: '', params: {},
  layers: [{ id: `${id}-sub`, title: 'Sub-layer', modules }] });
const draft = () => ({ title: 'Tree edits', duration: 12, layers: [{ id: 'l', title: 'Layer', level: 1, blend: 'add',
  modules: [source('top', { speed: binding }), composite('outer', [composite('inner', [source('nested', {
    speed: binding, colours: { pick: 'body', rotate: binding }, motion: lfo,
  })])])] }], globals: { macros: { storm: { value: 0.5, min: 0, max: 1 } }, live: ['bpm', 'storm'] },
  automation: { storm: [[0, 0.5], [12, 0.5]] } });
const params = (look) => flatModules(look.layers[0].modules).find((m) => m.id === 'nested').params;

test('M21: macro rename/delete carries every nested binding, rotate, swing and pace', () => {
  const look = draft(), before = structuredClone(look);
  const renamed = { ...look, ...renameMacro(look, 'storm', 'rain') }, p = params(renamed);
  assert.equal(p.speed.name, 'rain');
  assert.equal(p.colours.rotate.name, 'rain');
  assert.deepEqual(p.motion, { ...lfo, amount: 'rain', pace: 'rain' });
  assert.deepEqual(renamed.automation, { rain: look.automation.storm });
  const deleted = { ...look, ...renameMacro(look, 'storm', null) }, q = params(deleted);
  assert.equal(q.speed, undefined);
  assert.deepEqual(q.colours, { pick: 'body', rotate: 0 });
  assert.deepEqual(q.motion, { mod: 'lfo', rate: 1, center: 0.5, depth: 0.5 });
  assert.equal(deleted.automation, undefined);
  assert.deepEqual(look, before, 'Undo keeps the entire original tree');
});

test('M21: uses lists nested bindings in tree order with their owning layer and module', () => {
  const uses = macroUses(draft()).get('storm');
  assert.deepEqual(uses.map(({ how, layer, module, key }) => ({ how, layer, module, key })), [
    { how: 'follows', layer: 'l', module: 'top', key: 'speed' },
    { how: 'follows', layer: 'l', module: 'nested', key: 'speed' },
    { how: 'follows', layer: 'l', module: 'nested', key: 'colours' },
    { how: 'swing', layer: 'l', module: 'nested', key: 'motion' },
    { how: 'pace', layer: 'l', module: 'nested', key: 'motion' },
  ]);
});

test('M22: live controls rename/delete with the macro and still validate for Save', () => {
  const look = draft(), before = structuredClone(look);
  const renamed = renameMacro(look, 'storm', 'rain'), deleted = renameMacro(look, 'storm', null);
  assert.deepEqual(renamed.globals.live, ['bpm', 'rain']);
  assert.deepEqual(deleted.globals.live, ['bpm']);
  Globals.parse(renamed.globals);
  Globals.parse(deleted.globals);
  assert.deepEqual(renameMacro({ ...look, globals: { ...look.globals, live: ['storm'] } }, 'storm', null)
    .globals.live, [], 'an explicit empty list keeps all live controls off');
  const implicit = renameMacro({ ...look, globals: { macros: look.globals.macros } }, 'storm', 'rain');
  assert.equal('live' in implicit.globals, false, 'implicit live controls stay implicit');
  assert.deepEqual(look, before);
});

test('M20: duplicated chains remap input and on at every depth and can be saved', () => {
  const chain = (id) => [source(id), { id: `${id}-filter`, title: 'Filter', kind: 'filter',
    code: 'function filter(c) { return c; }', params: {}, input: id, on: id }];
  const original = { id: 'l', title: 'Layer', modules: [...chain('top'), composite('outer', [
    composite('inner', chain('nested'))])], groups: [], level: 1, blend: 'add' };
  const before = structuredClone(original), copy = makeLayer(original, null);
  const old = flatModules(original.modules), next = flatModules(copy.modules);
  assert.equal(next.length, old.length);
  for (let i = 0; i < old.length; i++) {
    assert.ok(!old.some((m) => m.id === next[i].id), 'every copied module has a fresh id');
    for (const key of ['input', 'on']) if (old[i][key]) {
      assert.equal(next[i][key], next[old.findIndex((m) => m.id === old[i][key])].id);
    }
  }
  Layers.parse([original, copy]);
  next.at(-1).params.amount = 0.5;
  assert.deepEqual(original, before, 'the duplicate owns its nested params');
});

test('M23: Automate creates and reopens lanes for nested numbers and colour rotation', () => {
  const look = draft(), range = { label: 'Speed', min: 0, max: 2 };
  params(look).speed = 0.25;
  params(look).colours.rotate = 0.25;
  const before = structuredClone(look);
  for (const [key, colour] of [['speed', undefined], ['colours', { value: 'all', blend: 'smooth' }]]) {
    const target = { layer: 'l', module: 'nested', key, colour, hint: 'Layer' };
    const result = automationEdit(look, range, 0.25, target);
    assert.ok(!('error' in result));
    const edited = { ...look, ...result.patch }, v = params(edited)[key];
    assert.equal((colour ? v.rotate : v).name, result.name);
    if (colour) assert.equal(v.pick, 'body');
    assert.deepEqual(edited.automation[result.name], [[0, 0.25], [12, 0.25]]);
    assert.deepEqual(automationEdit(edited, range, 0.7, target), { name: result.name, patch: {} });
  }
  assert.deepEqual(look, before);
});

test('M23: missing automation targets have their own failure, distinct from capacity', () => {
  const look = draft(), range = { label: 'Speed', min: 0, max: 1 };
  assert.deepEqual(automationEdit(look, range, 0.5, { layer: 'l', module: 'gone', key: 'speed' }),
    { error: 'not-found' });
  assert.deepEqual(automationEdit(look, range, 0.5, { macro: 'gone' }), { error: 'not-found' });
  const full = { ...look, globals: { macros: Object.fromEntries(Array.from({ length: 16 }, (_, i) =>
    [`macro${i}`, { value: 0.5, min: 0, max: 1 }])) } };
  assert.deepEqual(automationEdit(full, range, 0.5), { error: 'limit' });
});
