// Add a layer's groups (shelf.tsx): what is auditioned plays on the groups picked for the new layer, and the view
// focuses them (studio-store's focusKey) while the shelf is open, then goes back to a layer's Groups drawer, if any.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import type { Layer } from '../public/js/ui/model.ts';
import type { Preview } from '../public/js/ui/preview.ts';

Object.assign(globalThis, { matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) });
const { createStudio } = await import('../public/js/ui/studio-store.ts');
const { auditioner } = await import('../public/js/ui/shelf.tsx');

const SOURCE = { name: 'glow', title: 'Glow', kind: 'source' as const, code: 'function pixel() {}', summary: '',
  category: 'other', tags: [] };
const BASE = [{ id: 'a', title: 'A', groups: ['g1'], blend: 'over', level: 1, modules: [] }] as unknown as Layer[];

/** A preview whose runtime keeps the look it is sent, as the sandbox's does. */
function fakePreview() {
  const r = { ready: true, layers: BASE, extra: {}, setLook(layers: Layer[], extra: object) {
    r.layers = layers; r.extra = extra;
  } };
  return { runtime: r, kick() {} } as unknown as Preview & { runtime: typeof r };
}

describe('Add a layer: where the new layer plays', () => {
  test('the audition plays on the groups picked, follows each change, and Escape puts the look back', () => {
    const pv = fakePreview(), A = auditioner({ pv, layer: { groups: ['g1'] } });
    A.regroup(['root']);
    A.now(SOURCE);
    assert.deepEqual(pv.runtime.layers.at(-1)?.groups, ['root']);
    A.regroup(['g2', 'g3']);
    assert.deepEqual(pv.runtime.layers.at(-1)?.groups, ['g2', 'g3']);
    assert.equal(pv.runtime.layers.length, 2);
    A.now(null);
    assert.equal(pv.runtime.layers, BASE);
    A.regroup(['g4']);                                   // nothing auditioned: nothing sent
    assert.equal(pv.runtime.layers, BASE);
  });

  test("a preset's layers all play on the groups picked", () => {
    const pv = fakePreview(), two = [{ ...BASE[0], id: 'p1' }, { ...BASE[0], id: 'p2' }];
    const A = auditioner({ pv, layer: {}, layers: () => two });
    A.regroup(['g2']);
    A.now({ ...SOURCE, kind: 'preset', layers: [] } as never);
    assert.deepEqual(pv.runtime.layers.slice(1).map((l) => l.groups), [['g2'], ['g2']]);
  });

  test('the view focuses the new layer\'s groups while they are picked, then the Groups drawer\'s layer', () => {
    const st = createStudio(null);
    st.look.value = { ...st.look.value, layers: BASE };
    st.groupsFor.value = 'a';
    assert.equal(st.focusKey.value, JSON.stringify([['g1'], null]));
    st.newGroups.value = ['g2'];
    assert.equal(st.focusKey.value, JSON.stringify([['g2'], null]));
    st.newGroups.value = [];                              // none ticked: the new layer lights nothing, all dim
    assert.equal(st.focusKey.value, JSON.stringify([[], null]));
    st.newGroups.value = null;
    assert.equal(st.focusKey.value, JSON.stringify([['g1'], null]));
  });
});
