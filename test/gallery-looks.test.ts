// A gallery look in the Studio and on its card: one's own opens as itself, so Save updates it; someone else's saves as
// a copy, but Check & bake bakes and reviews the shared look itself (bake.tsx's savesFirst); the card's Approve bakes
// what needs it and reviews that same look, asking a reason for flashing (approve.tsx).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { beforeEach, describe, test } from 'vitest';

import type { Look } from '../shared/schemas/api.ts';
import type { Rig } from '../shared/schemas/rig.ts';

Object.assign(globalThis, { matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  document: { title: '' }, history: { replaceState() {} }, location: { pathname: '/', search: '' } });
const { api } = await import('../public/js/api.ts');
const { createStudio } = await import('../public/js/ui/studio-store.ts');
const { savesFirst } = await import('../public/js/ui/bake.tsx');
const { approve, nextStep } = await import('../public/js/ui/approve.tsx');

const RIG = JSON.parse(readFileSync(new URL('../public/data/rig.json', import.meta.url), 'utf8')) as Rig;
const LOOK = { id: 'k1', owner: 'ana', ownerName: 'ana', title: 'Disco', summary: '', duration: 30, shared: true,
  layers: [{ id: 'a', title: 'Sea', blend: 'add', level: 1,
    modules: [{ id: 'm1', kind: 'source', title: 'Glow', code: 'function pixel() {}', params: {} }] }] };
const DONE = { source: 'render-box', status: 'done', ok: true };

let calls: string[];
beforeEach(() => { calls = []; });
/** The Studio with LOOK open, as `who`, its title edited. */
function opened(who: string) {
  const st = createStudio({ id: who, username: who, role: who === 'ana' ? 'member' : 'curator' });
  st.setup(RIG, [], LOOK as unknown as Look);
  st.look.value = { ...st.look.value, title: 'Disco 2' };
  Object.assign(api, {
    createLook: async () => { calls.push('create'); return { look: { ...LOOK, id: 'copy', owner: who } }; },
    updateLook: async (id: string) => { calls.push(`update ${id}`); return { look: { ...LOOK, title: 'Disco 2' } }; },
  });
  return st;
}

describe('a gallery look in the Studio', () => {
  test('one\'s own opens as itself: Save updates it, never a copy', async () => {
    const st = opened('ana');
    assert.equal(st.copyOnSave.value, false);
    assert.equal(await st.save(), true);
    assert.deepEqual(calls, ['update k1']);
  });

  test('someone else\'s saves as a copy, but Check & bake bakes the shared look, unsaved edits and all', async () => {
    const st = opened('cat');
    assert.equal(st.copyOnSave.value, true);
    assert.equal(st.dirty.value, true);
    assert.equal(savesFirst(st), false, 'the bake is of k1 as shared');
    const own = opened('ana');
    assert.equal(own.dirty.value && savesFirst(own), true, 'one\'s own edits save first');
    assert.equal(await st.save(), true);
    assert.deepEqual(calls, ['create']);
  });
});

describe('Approve on a gallery card', () => {
  test('what it does next for each bake', () => {
    const steps = [null, { ...DONE, source: 'fleet-box' }, { ...DONE, status: 'running' }, DONE,
      { ...DONE, status: 'failed', ok: false, analysis: { flicker: { ok: false } } },
      { ...DONE, status: 'failed', ok: false, reason: 'threw' }].map((b) => nextStep(b as never));
    assert.deepEqual(steps, ['bake', 'bake', 'wait', 'approve', 'reason', 'failed']);
  });

  test('bakes the gallery look when it has no bake, then reviews that same look', async () => {
    const bakes = [undefined, DONE];
    Object.assign(api, {
      look: async (id: string) => { calls.push(`get ${id}`); return { look: { ...LOOK, bake: bakes.shift() } }; },
      bake: async (id: string) => { calls.push(`bake ${id}`); return { bake: { status: 'queued' } }; },
      updateLook: async (id: string, b: object) => { calls.push(`update ${id} ${JSON.stringify(b)}`); return {}; },
    });
    let baking = 0;
    assert.equal(await approve('k1', () => baking++), true);
    assert.deepEqual(calls, ['get k1', 'bake k1', 'get k1', 'update k1 {"reviewed":true}']);
    assert.equal(baking, 1);
  });

  test('a failed bake is not approved, and nothing is sent', async () => {
    Object.assign(api, {
      look: async () => ({ look: { ...LOOK, bake: { ...DONE, status: 'failed', ok: false, reason: 'It threw.' } } }),
      updateLook: async () => { calls.push('update'); return {}; },
    });
    assert.equal(await approve('k1', () => {}), false);
    assert.deepEqual(calls, []);
  });
});
