// The groups tree's edits (ui/groups-model.ts): a group ticks and unticks with everything under it, a parent shows
// partly ticked, all its children ticked tick it, and none ticked is a layer's valid pick; the Studio keeps it so.
// While they are picked, the view lights where the layer plays (the index's layer mask).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import { groupChecked, groupPartial, toggleGroup, type Tree } from '../public/js/ui/groups-model.ts';
import { buildGroupIndex, cleanLayer, makeLayer, normaliseLayers } from '../public/js/ui/model.ts';

// all ─┬ arches ─┬ a1
//      │         └ a2 ─ a2x
//      ├ spires ─┬ s1
//      │         └ s2
//      └ rose
const PARENT: Record<string, string | null> = { all: null, arches: 'all', a1: 'arches', a2: 'arches', a2x: 'a2',
  spires: 'all', s1: 'spires', s2: 'spires', rose: 'all' };
const children = new Map<string | null, { id: string }[]>();
for (const [id, p] of Object.entries(PARENT)) children.set(p, [...children.get(p) ?? [], { id }]);
const tree: Tree = { children, ancestors(id) {
  const out = [];
  for (let p = PARENT[id]; p; p = PARENT[p]) out.push(p);
  return out;
} };
const on = (ids: string[], id: string) => toggleGroup(ids, tree, id, true);
const off = (ids: string[], id: string) => toggleGroup(ids, tree, id, false);
const ticked = (ids: string[]) => Object.keys(PARENT).filter((g) => groupChecked(new Set(ids), tree, g)).sort();
const partly = (ids: string[]) => Object.keys(PARENT).filter((g) => groupPartial(new Set(ids), tree, g)).sort();

describe('the groups tree', () => {
  test('ticking a group ticks every group under it, at any depth', () => {
    const ids = on([], 'arches');
    assert.deepEqual(ids, ['arches']);
    assert.deepEqual(ticked(ids), ['a1', 'a2', 'a2x', 'arches']);
    assert.deepEqual(on(['a1', 'a2x', 's1'], 'arches'), ['s1', 'arches'], 'its picked groups fold into it');
    assert.deepEqual(on(['arches'], 'a1'), ['arches']);
    assert.deepEqual(on(['elsewhere'], 'rose'), ['elsewhere', 'rose']);
  });

  test('unticking a group unticks every group under it', () => {
    assert.deepEqual(ticked(off(['arches', 'rose'], 'arches')), ['rose']);
    assert.deepEqual(off(['a1', 'a2x', 'rose'], 'arches'), ['rose'], 'picked groups under it go too');
    assert.deepEqual(off(['rose'], 'rose'), []);
    assert.deepEqual(off(['all'], 'all'), []);
    assert.deepEqual(ticked([]), []);
    assert.deepEqual(partly([]), []);
  });

  test('unticking a group under a ticked one leaves the rest of that one ticked', () => {
    const ids = off(['all'], 'a2x');
    assert.deepEqual(ids.sort(), ['a1', 'rose', 'spires']);
    assert.deepEqual(ticked(ids), ['a1', 'rose', 's1', 's2', 'spires']);
    assert.deepEqual(partly(ids), ['all', 'arches'], 'a2 has nothing under it ticked');
  });

  test('some children ticked: the parent is partly ticked; all of them: the parent is ticked', () => {
    const one = on([], 's1');
    assert.deepEqual(partly(one), ['all', 'spires']);
    const both = on(one, 's2');
    assert.deepEqual(both, ['spires']);
    assert.deepEqual(partly(both), ['all']);
    assert.deepEqual(on(on(both, 'arches'), 'rose'), ['all'], 'every child of the root: the root');
  });
});

describe('a layer with no groups picked', () => {
  const rig = { groups: [{ id: 'all', name: 'All', parent: null }] } as unknown as Parameters<typeof makeLayer>[1];

  test('stays empty through cleaning, normalising and duplicating; none given still means the whole rig', () => {
    const [none, whole] = normaliseLayers([{ id: 'a', groups: [], modules: [] }, { id: 'b', modules: [] }], rig);
    assert.deepEqual(none.groups, []);
    assert.deepEqual(whole.groups, ['all']);
    assert.deepEqual(makeLayer({ ...cleanLayer(none), title: 'copy' }, rig).groups, []);
    assert.deepEqual(makeLayer({ title: 'new' }, rig).groups, ['all']);
  });
});

describe('the view while a layer\'s groups are picked', () => {
  const rig = JSON.parse(readFileSync(new URL('../public/data/rig.json', import.meta.url), 'utf8'));
  const index = buildGroupIndex(rig), lit = (m: Uint8Array) => m.reduce((n, v) => n + v, 0);
  const [a, b] = index.children.get(index.root) || [];

  test('lights the layer\'s groups (each its whole subtree), nothing for none, the whole rig for none given', () => {
    assert.equal(lit(index.layerMask([a.id])), index.counts.get(a.id));
    assert.equal(lit(index.layerMask([a.id, b.id])), lit(index.layerMask([a.id])) + lit(index.layerMask([b.id])));
    assert.equal(lit(index.layerMask([])), 0);
    assert.equal(lit(index.layerMask(undefined)), rig.count);
  });

  test('the groups pointed at or pinned light too, whatever the layer plays on', () => {
    assert.equal(lit(index.layerMask([], undefined, b.id)), index.counts.get(b.id));
    assert.equal(lit(index.layerMask([a.id], undefined, null, b.id)), lit(index.layerMask([a.id, b.id])));
    assert.equal(lit(index.layerMask([a.id], undefined, a.id, null)), index.counts.get(a.id));
  });
});
