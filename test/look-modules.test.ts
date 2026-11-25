// The one walk over a look's modules (SPEC-looks "Modules"): what it meets and in what order, where the shape breaks,
// the map the library-only step takes, and the save check and bake key that go through it.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { eachModule, findModule, mapModules, moduleCodes } from '../shared/look-modules.ts';
import { renderFields } from '../src/bake.ts';
import { customCode } from '../src/library-gate.ts';
import { sha256 } from '../src/library-history.ts';

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

test('maps each module, composites rebuilt round theirs; null where the shape breaks or the map refuses', () => {
  const up = mapModules(LAYERS, (m) => ({ ...m, code: String(m.code).toUpperCase() }));
  assert.deepEqual(moduleCodes(up), ['ONE', 'A', 'B', 'C', 'D', 'E']);
  assert.equal((up![1]!.modules as { title: string }[])[1]!.title, 'Comp', 'the composite kept');
  assert.equal(moduleCodes(LAYERS)[1], 'a', 'the layers given are not changed');
  assert.equal(mapModules(LAYERS, (m) => (m.code === 'c' ? null : m)), null);
  assert.equal(mapModules([{ modules: [comp([{ modules: [mod('a')] }], { code: 'x' })] }], (m) => m), null);
  assert.equal(mapModules([{ modules: [null] }], (m) => m), null);
  for (const broken of [comp([]), comp(undefined), comp([{ modules: [mod('a')] }], { code: null })]) {
    assert.equal(mapModules([{ modules: [broken] }], (m) => m), null, 'a malformed composite is not kept');
  }
  assert.equal(mapModules('nope', (m) => m), null);
});

test('the save check: library code, or a ref the library has with no code; a composite with code is custom', () => {
  const hashes = new Set(['a', 'b', 'c', 'd', 'e', 'one'].map(sha256)), refs = new Set(['wave']);
  assert.equal(customCode(LAYERS, hashes), '');
  assert.equal(customCode([{ modules: [{ ref: 'wave', title: 'W' }] }], hashes, refs), '', 'a ref alone');
  assert.match(customCode([{ modules: [{ ref: 'gone', title: 'G' }] }], hashes, refs), /Layer 1's G is custom/);
  assert.match(customCode([{ title: 'Mix', modules: [comp([{ modules: [mod('a')] }], { code: 'a' })] }], hashes),
    /Layer 1 \(Mix\)'s Comp is custom/, 'even library code on a composite');
  assert.match(customCode([LAYERS[0], null], hashes), /Layer 2 is custom/);
});

test('a bake\'s key counts tempo read anywhere a module runs, a composite\'s sub-layers too', () => {
  const tempo = (code: string) => [{ modules: [comp([{ modules: [mod('a', { code })] }])] }];
  assert.ok('bpm' in (renderFields({ layers: tempo('G.bpm') } as never) as object));
  assert.ok(Array.isArray(renderFields({ layers: tempo('G.palette') } as never)), 'no tempo: the plain layers');
});
