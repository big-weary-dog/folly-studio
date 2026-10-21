// History's steps (SPEC-history "Steps"): every edit is a step named for what it changed, quick edits to one thing
// fold into one, a jump back greys the later steps and a new edit drops them, a save is a marker that undo crosses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import type { Look } from '../shared/schemas/api.ts';
import type { Rig } from '../shared/schemas/rig.ts';

Object.assign(globalThis, { matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  document: { title: '' } });
const { createStudio } = await import('../public/js/ui/studio-store.ts');
const { createSteps, named } = await import('../public/js/ui/history/steps.ts');

const RIG = JSON.parse(readFileSync(new URL('../public/data/rig.json', import.meta.url), 'utf8')) as Rig;
const mod = (code = 'function pixel() { return [1, 0, 0]; }', params = {}) =>
  ({ id: 'm1', kind: 'source', title: 'Glow', code, params });
const LOOK = { id: 'k1', owner: 'u', ownerName: 'u', title: 'Embers', summary: '', duration: 30, shared: false,
  layers: [{ id: 'a', title: 'Sea', blend: 'add', level: 1, modules: [mod()] }] } as unknown as Look;

function studio() {
  const st = createStudio({ id: 'u', username: 'u', role: 'member' });
  st.setup(RIG, [], LOOK);
  return st;
}
const labels = (st: ReturnType<typeof studio>) => st.history.list.peek().map((s) => s.label);

describe('steps', () => {
  test('each edit is named for what it changed', () => {
    const st = studio(), L = st.look.peek(), a = L.layers[0];
    const lay = (x: object) => ({ ...L, layers: [{ ...a, ...x }] });
    assert.equal(named(L, { ...L, title: 'Coals' }).label, 'Renamed the look');
    assert.equal(named(L, lay({ level: 0.5 })).label, 'Level 50%');
    assert.equal(named(L, lay({ modules: [mod('x')] })).label, 'Edited the code of “Glow”');
    assert.equal(named(L, lay({ modules: [mod(undefined, { speed: 2 })] })).label, 'Set speed');
    assert.equal(named(L, { ...L, layers: [] }).label, 'Deleted a layer');
    assert.equal(named(L, { ...L, layers: [a, { ...a, id: 'b' }] }).label, 'Added a layer');
    assert.equal(named(L, { ...L, bpm: 128 }).label, 'Tempo 128 bpm');
    assert.equal(named(L, { ...L, globals: { macros: { storm: { value: 1, min: 0, max: 1 } } } }).label, 'Set macros');
  });

  test('quick edits to one thing fold into one step until sealed; other edits are their own', () => {
    const st = studio();
    for (const level of [0.9, 0.8, 0.7]) st.editLayer('a', () => ({ level }));
    assert.deepEqual(labels(st), ['Opened the look', 'Level 70%']);
    st.history.seal();
    st.editLayer('a', () => ({ level: 0.6 }));
    st.edit(() => ({ title: 'Coals' }));
    assert.deepEqual(labels(st), ['Opened the look', 'Level 70%', 'Level 60%', 'Renamed the look']);
    st.edit(() => ({ title: 'Coals' }));   // no change: no step
    assert.equal(st.history.list.peek().length, 4);
  });

  test('a jump back plays the look as it was; a new edit drops the steps ahead', () => {
    const st = studio();
    st.editLayer('a', () => ({ level: 0.5 }));
    st.edit(() => ({ title: 'Coals' }));
    st.undo();
    assert.deepEqual([st.look.peek().title, st.look.peek().layers[0].level, st.history.at.peek()], ['Embers', 0.5, 1]);
    st.jump(0);
    assert.equal(st.look.peek().layers[0].level, 1);
    st.redo();
    st.redo();
    assert.equal(st.look.peek().title, 'Coals');
    st.jump(1);
    st.editLayer('a', () => ({ blend: 'over' }));
    assert.deepEqual(labels(st), ['Opened the look', 'Level 50%', 'Blend over']);
    assert.equal(st.look.peek().id, 'k1', 'a step puts back content, never the id');
  });

  test("a save is a marker: undoing past it leaves the look unsaved, and redo saves' state again", () => {
    const st = studio();
    st.editLayer('a', () => ({ level: 0.5 }));
    st.saved.value = JSON.stringify(st.body.peek());   // as save() leaves it
    st.history.saved();
    assert.equal(st.dirty.peek(), false);
    st.undo();
    assert.equal(st.dirty.peek(), true);
    st.redo();
    assert.equal(st.dirty.peek(), false);
    assert.equal(st.history.list.peek()[1].saved, true);
  });

  test("a toast's Undo undoes its own step, and only while it is the step now", () => {
    const st = studio();
    st.edit(() => ({ layers: [] }));
    const step = st.step();
    st.undoStep(step);
    assert.equal(st.look.peek().layers.length, 1);
    st.redo();
    st.edit(() => ({ title: 'Later' }));
    st.undoStep(step);   // another edit came after: nothing undone
    assert.equal(st.look.peek().title, 'Later');
  });

  test('a group of edits is one step; AI rounds undone are told once, dropped ones too', () => {
    const h = createSteps(), st = studio(), L = st.look.peek();
    h.start(L);
    const o = { step: 'Added the preset “Fire”', kind: 'add', merge: 'preset:1' } as const;
    h.record(L, { ...L, globals: { macros: { storm: { value: 1, min: 0, max: 1 } } } }, o);
    h.record(L, { ...L, layers: [] }, o);
    assert.equal(h.list.peek().length, 2);
    const ai = (id: string) => ({ ideaId: id, asked: 'slower', changes: [] });
    h.record(L, { ...L, title: 'x' }, { step: 'AI', kind: 'ai', ai: ai('i1') });
    h.record(L, { ...L, title: 'y' }, { step: 'AI', kind: 'ai', ai: ai('i2') });
    h.at.value = 1;
    h.record(L, { ...L, title: 'z' });   // drops both rounds
    assert.deepEqual(h.undoneRounds(), ['i1', 'i2']);
    assert.deepEqual(h.undoneRounds(), []);
  });

  test('previewing a version holds the work; restoring it is a step', () => {
    const st = studio();
    st.editLayer('a', () => ({ level: 0.4 }));
    const v = { ...LOOK, n: 1, layers: [{ ...LOOK.layers[0], level: 0.9 }] } as never;
    st.preview(v, 'Saved');
    st.edit(() => ({ title: 'Blocked' }));
    assert.equal(st.work.peek().title, 'Embers');
    st.back();
    assert.equal(st.look.peek().layers[0].level, 0.4);
    st.preview(v, 'Saved');
    void st.restore();   // the save fails here (no server): the step is made first
    assert.equal(st.history.list.peek().at(-1)!.label, 'Restored version 1');
    assert.equal(st.look.peek().layers[0].level, 0.9);
  });
});
