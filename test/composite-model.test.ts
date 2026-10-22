// The Studio's edits of a chain that holds composites (ui/composite-model.ts, SPEC-library "Composites"): a module
// moved into a sub-layer and out (the sub-layer it empties going with it), a source made a sub-layer of its own,
// sub-layers reordered, a module grouped into a composite and back.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { Module } from '../shared/schemas/look.ts';
import { groupModule, moveModule, moveSub, moveToSub, removeModule, ungroup } from '../public/js/ui/composite-model.ts';

const m = (id: string): Module => ({ id, kind: 'source', title: id, code: '', params: {} });
const CHAIN: Module[] = [{ id: 'c', kind: 'composite', title: 'C', code: '', params: {}, layers: [
  { id: 's1', title: 'One', modules: [m('a')] }, { id: 's2', title: 'Two', modules: [m('b'), m('x')] },
  { id: 's3', title: 'Three', modules: [m('d')] }] }, m('t')];
const ids = (mods: Module[]): string => mods.map((x) => x.layers ? `${x.id}{${x.layers.map((s) => ids(s.modules))
  .join('|')}}` : x.id).join(' ');

test('a module moves into a sub-layer and out; the sub-layer it empties goes, never a composite\'s last', () => {
  const into = moveModule(CHAIN, 't', { comp: 'c', sub: 1 }, 1)!;
  assert.equal(ids(into), 'c{a|b t x|d}');
  assert.equal(ids(moveModule(into, 't', null, 2)!), 'c{a|b x|d} t');
  assert.equal(ids(moveModule(CHAIN, 'a', null, 0)!), 'a c{b x|d} t', 'One goes');
  assert.equal(ids(moveModule(CHAIN, 'a', { comp: 'c', sub: 2 }, 1)!), 'c{b x|d a} t', 'Three, after One went');
  const tinted = moveModule(CHAIN.map((x) => (x.layers ? { ...x, layers: x.layers.map((s, k) => (k ? s
    : { ...s, blend: 'max' as const })) } : x)), 'a', null, 2)!;
  assert.equal(tinted[2].blend, 'max', 'its sub-layer\'s blend comes out with it');
  const one: Module[] = [{ ...CHAIN[0], layers: [CHAIN[0].layers![0]] }, m('t')];
  assert.equal(moveModule(one, 'a', null, 2), null, 'a composite keeps a sub-layer');
  assert.equal(moveModule(CHAIN, 'c', { comp: 'c', sub: 0 }, 0), null, 'not inside itself');
  assert.equal(moveModule(CHAIN, 't', null, 1), CHAIN, 'where it is: nothing changes');
});

test('sub-layers reorder, the index counted before the move', () => {
  const order = (mods: Module[]) => mods[0].layers!.map((s) => s.title).join(' ');
  assert.equal(order(moveSub(CHAIN, 'c', 2, 0)), 'Three One Two');
  assert.equal(order(moveSub(CHAIN, 'c', 0, 2)), 'Two One Three');
  assert.equal(order(moveSub(CHAIN, 'c', 0, 3)), 'Two Three One');
  assert.equal(moveSub(CHAIN, 'c', 1, 2), CHAIN, 'in its place');
});

test('a module groups into a composite of one sub-layer, and ungroups back', () => {
  const grouped = groupModule(CHAIN, 't'), made = grouped[1];
  assert.equal(made.kind, 'composite');
  assert.equal(ids(made.layers![0].modules), 't');
  assert.equal(ids(ungroup(grouped, made.id)!), ids(CHAIN));
  assert.equal(ungroup(CHAIN, 'c'), null, 'three sub-layers stay');
});

test('a warp or filter attaches to a source and detaches; a source moves with its run (Attached modules)', () => {
  const w = (id: string, on?: string): Module => ({ id, kind: 'warp', title: id, code: '', params: {},
    ...(on ? { on } : {}) });
  const flat: Module[] = [m('a'), w('w'), m('b')];
  const on = (mods: Module[]) => mods.map((x) => (x.on ? `${x.id}@${x.on}` : x.id)).join(' ');
  const attached = moveModule(flat, 'w', null, 1, 'a')!;
  assert.equal(on(attached), 'a w@a b');
  assert.equal(on(moveModule(flat, 'w', null, 3, 'b')!), 'a b w@b');
  assert.equal(on(moveModule(attached, 'w', null, 3)!), 'a b w', 'detached, below b');
  assert.equal(on(moveModule(attached, 'a', null, 3)!), 'b a w@a', 'the source takes its run');
  assert.equal(moveModule(flat, 'b', null, 1, 'a'), null, 'a source does not attach');
  assert.equal(moveModule(attached, 'b', null, 1), null, 'nothing lands inside a run');
  assert.equal(on(removeModule(attached, 'a')!), 'b');
  assert.equal(ids(groupModule(attached, 'a')[0].layers![0].modules), 'a w');
  assert.equal(groupModule(attached, 'w'), attached, 'an attached module groups with its source');
});

test('a source becomes a sub-layer of its own; a whole sub-layer moves as itself; a delete empties one', () => {
  const made = moveToSub([...CHAIN.slice(0, 1), { ...m('t'), blend: 'add' }], 't', 'c', 1)!;
  assert.equal(ids(made), 'c{a|t|b x|d}');
  assert.equal(made[0].layers![1].blend, 'add', 'the source\'s blend is the sub-layer\'s');
  assert.equal(made[0].layers![1].modules[0].blend, undefined);
  const order = (mods: Module[]) => mods[0].layers!.map((s) => s.title).join(' ');
  assert.equal(order(moveToSub(CHAIN, 'd', 'c', 0)!), 'Three One Two', 'a sub-layer of one source reorders');
  assert.equal(ids(moveToSub(CHAIN, 'b', 'c', 0)!), 'c{b|a|x|d} t', 'one of two sources: a sub-layer of its own');
  assert.equal(moveToSub(CHAIN, 'c', 'c', 0), null, 'not inside itself');
  const full = moveToSub(CHAIN, 't', 'c', 3)!;
  assert.equal(moveToSub([...full, m('u')], 'u', 'c', 0), null, 'four at most');
  assert.equal(ids(removeModule(CHAIN, 'a')!), 'c{b x|d} t');
  assert.equal(removeModule([{ ...CHAIN[0], layers: [CHAIN[0].layers![0]] }], 'a'), null);
});
