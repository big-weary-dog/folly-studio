// The Studio's edits of a chain that holds composites (ui/composite-model.ts, SPEC-library "Composites"): a module
// moved into a sub-layer and out, sub-layers reordered, a module grouped into a composite and back.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { Module } from '../shared/schemas/look.ts';
import { groupModule, moveModule, moveSub, ungroup } from '../public/js/ui/composite-model.ts';

const m = (id: string): Module => ({ id, kind: 'source', title: id, code: '', params: {} });
const CHAIN: Module[] = [{ id: 'c', kind: 'composite', title: 'C', code: '', params: {}, layers: [
  { id: 's1', title: 'One', modules: [m('a')] }, { id: 's2', title: 'Two', modules: [m('b'), m('x')] },
  { id: 's3', title: 'Three', modules: [m('d')] }] }, m('t')];
const ids = (mods: Module[]): string => mods.map((x) => x.layers ? `${x.id}{${x.layers.map((s) => ids(s.modules))
  .join('|')}}` : x.id).join(' ');

test('a module moves into a sub-layer and out, and never leaves a list empty', () => {
  const into = moveModule(CHAIN, 't', { comp: 'c', sub: 1 }, 1)!;
  assert.equal(ids(into), 'c{a|b t x|d}');
  assert.equal(ids(moveModule(into, 't', null, 2)!), 'c{a|b x|d} t');
  assert.equal(moveModule(CHAIN, 'a', null, 0), null, 'One would be empty');
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
