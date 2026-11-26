// The one walk over a look's modules (spec/looks "Modules"): what it meets and in what order, where the shape breaks,
// and the save check and bake key that go through it.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { eachModule, findModule, moduleCodes } from '../shared/look-modules.ts';
import { renderFields } from '../src/bake.ts';
import { unknownRef } from '../src/library-gate.ts';

const mod = (id: string, extra: object = {}) => ({ id, kind: 'source', title: id.toUpperCase(), code: id, ...extra });
const comp = (layers: unknown, extra: object = {}) => ({ id: 'c', kind: 'composite', title: 'Comp', code: '', layers,
  ...extra });
const LAYERS = [
  { id: 'l1', title: 'One', code: 'one' },
  { id: 'l2', title: 'Two', modules: [mod('a'), comp([{ id: 's1', modules: [mod('b'), comp([{ id: 's2',
    modules: [mod('c')] }])] }, { id: 's3', code: 'd' }]), mod('e')] },
];

test('meets every module that runs code, in order, at any depth; a composite runs none of its own', () => {
  assert.deepEqual(moduleCodes(LAYERS), ['one', 'a', 'b', 'c', 'd', 'e']);
  const where: unknown[] = [];
  findModule(LAYERS, (met) => { where.push([met.at, met.layer?.id]); });
  assert.deepEqual(where, [[0, 'l1'], [1, 'l2'], [1, 'l2'], [1, 'l2'], [1, 'l2'], [1, 'l2']],
    'each is met with the look\'s layer it sits in');
  assert.equal(findModule(LAYERS, (met) => met.module?.code === 'c')?.module?.id, 'c', 'stops where it is told');
  assert.deepEqual(moduleCodes(null), [], 'no layers: nothing');
});

test('says where the shape breaks, and still walks a broken composite\'s sub-layers', () => {
  const faults = (layers: unknown) => {
    const out: unknown[] = [];
    findModule(layers, (met) => { out.push(met.fault ?? met.module!.id); });
    return out;
  };
  assert.deepEqual(faults([null, { modules: [7, mod('a')] }]), ['layer', 'module', 'a']);
  assert.deepEqual(faults([{ modules: [comp([{ modules: [mod('a')] }], { code: 'x' })] }]), ['composite', 'a']);
  assert.deepEqual(faults([{ modules: [comp(undefined)] }]), ['composite'], 'a composite without sub-layers');
  for (const code of [false, 0, null]) {
    assert.deepEqual(faults([{ modules: [comp([{ modules: [mod('a')] }], { code })] }]), ['composite', 'a'],
      `code ${code} is not none`);
  }
  assert.deepEqual(faults([{ modules: [comp([])] }]), ['composite'], 'no sub-layers');
  assert.deepEqual(faults([{ modules: [comp([{ modules: [mod('a')] }], { code: undefined })] }]), ['a']);
  const seen: unknown[] = [];
  eachModule([null, { modules: [comp([{ modules: [mod('a')] }], { code: 'x' })] }], (m) => seen.push(m.id));
  assert.deepEqual(seen, ['a'], 'eachModule passes over where it breaks');
});

test('the save check: each module names a library module, whatever code it carries; a broken shape names none', () => {
  const refs = new Set(['wave']);
  assert.equal(unknownRef([{ modules: [{ ref: 'wave', title: 'W' }] }], refs), '', 'a ref alone');
  assert.equal(unknownRef([{ modules: [{ ref: 'wave', title: 'W', code: 'edited' }] }], refs), '',
    'a known ref wins over its code');
  assert.equal(unknownRef([{ modules: [comp([{ modules: [{ ref: 'wave' }] }])] }], refs), '', 'a composite\'s too');
  assert.match(unknownRef([{ modules: [{ ref: 'gone', title: 'G' }] }], refs),
    /^Layer 1's G names gone, which the library does not have\.$/);
  assert.match(unknownRef([{ modules: [{ title: 'X', code: 'edited' }] }], refs), /Layer 1's X names none/);
  assert.match(unknownRef([{ title: 'Mix', modules: [comp([{ modules: [{ ref: 'wave' }] }], { code: 'a' })] }], refs),
    /Layer 1 \(Mix\)'s Comp names none/, 'a composite with code is broken');
  assert.match(unknownRef([{ modules: [{ ref: 'wave' }] }, null], refs), /Layer 2 names none/);
});

test('a bake\'s key counts tempo read anywhere a module runs, a composite\'s sub-layers too', () => {
  const tempo = (code: string) => [{ modules: [comp([{ modules: [mod('a', { code })] }])] }];
  assert.ok('bpm' in (renderFields({ layers: tempo('G.bpm') } as never) as object));
  assert.ok(Array.isArray(renderFields({ layers: tempo('G.palette') } as never)), 'no tempo: the plain layers');
});
