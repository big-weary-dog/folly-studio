// Replies that land after the Studio moved on (studio-store's rev and request): a refinement never replaces edits
// made while it ran, a save's reply keeps a title typed after Save, and a reply after a newer request of its kind
// (a version's preview) or after the Studio closed (a failed load's redirect, a save's toast) is ignored.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { afterEach, describe, test, vi } from 'vitest';

import type { Look } from '../shared/schemas/api.ts';
import type { Rig } from '../shared/schemas/rig.ts';

Object.assign(globalThis, { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  document: { title: '' } });
const { api } = await import('../public/js/api.ts');
const { createStudio } = await import('../public/js/ui/studio-store.ts');
const { refine } = await import('../public/js/ui/refine.tsx');
const { toastHistory } = await import('../public/js/ui/kit.tsx');

const RIG = JSON.parse(readFileSync(new URL('../public/data/rig.json', import.meta.url), 'utf8')) as Rig;
const LOOK = { id: 'k1', owner: 'u', ownerName: 'u', title: 'Embers', summary: '', duration: 30, shared: false,
  layers: [{ id: 'a', title: 'Sea', blend: 'add', level: 1,
    modules: [{ id: 'm1', kind: 'source', title: 'Glow', code: 'function pixel() { return [1, 0, 0]; }' }] }],
} as unknown as Look;

function studio() {
  const st = createStudio({ id: 'u', username: 'u', role: 'member' });
  st.setup(RIG, [], LOOK);
  return st;
}
/** A promise and its resolve, to hold a reply. */
function held<T>() {
  let resolve!: (v: T) => void;
  return { promise: new Promise<T>((r) => { resolve = r; }), resolve };
}
const original = { ...api };
afterEach(() => { Object.assign(api, original); });

describe('a refinement over edits made while it ran', () => {
  test('the edits stay, unsaved; the revision is the server copy', async () => {
    const st = studio(), done = held<{ idea: object }>();
    const revised = { ...LOOK, layers: [{ ...LOOK.layers[0], level: 0.5 }], version: 2 } as unknown as Look;
    Object.assign(api, { refine: async () => ({ idea: { id: 'i1', status: 'queued', updatedAt: '' } }),
      idea: () => done.promise, look: async () => ({ look: revised }) });
    const running = refine(st, { text: 'dimmer' });
    await new Promise((r) => setTimeout(r, 0));
    st.editLayer('a', () => ({ level: 0.23 }));
    done.resolve({ idea: { id: 'i1', status: 'ready', changes: ['Sea: level 1 → 0.5'] } });
    await running;
    assert.equal(st.look.peek().layers[0].level, 0.23);
    assert.equal(st.dirty.peek(), true);
    assert.equal(st.server.peek(), revised);
    assert.match(toastHistory.at(-1)!.message, /your edits stay/);
  });

  test('untouched work takes the revision, saved', async () => {
    const st = studio();
    const revised = { ...LOOK, layers: [{ ...LOOK.layers[0], level: 0.5 }] } as unknown as Look;
    Object.assign(api, { refine: async () => ({ idea: { id: 'i1', status: 'ready', changes: ['x'] } }),
      look: async () => ({ look: revised }) });
    await refine(st, { text: 'dimmer' });
    assert.equal(st.look.peek().layers[0].level, 0.5);
    assert.equal(st.dirty.peek(), false);
  });
});

describe('a save reply', () => {
  test('keeps a title typed after Save', async () => {
    const st = studio(), reply = held<{ look: Look }>();
    st.edit(() => ({ title: 'Before save' }));
    Object.assign(api, { updateLook: () => reply.promise });
    const saving = st.save();
    st.edit(() => ({ title: 'Typed while saving' }));
    reply.resolve({ look: { ...LOOK, title: 'Before save' } });
    assert.equal(await saving, true);
    assert.equal(st.look.peek().title, 'Typed while saving');
    assert.equal(st.dirty.peek(), true);
  });

  test('after the Studio closed, a new look neither moves the URL nor says Saved', async () => {
    const st = createStudio({ id: 'u', username: 'u', role: 'member' }), reply = held<{ look: Look }>();
    st.setup(RIG, [], null);
    st.edit(() => ({ title: 'New' }));
    const moved = vi.fn<() => void>();
    vi.stubGlobal('history', { replaceState: moved, state: null });
    try {
      Object.assign(api, { createLook: () => reply.promise });
      const saving = st.save(), toasts = toastHistory.length;
      st.dispose();
      reply.resolve({ look: { ...LOOK, title: 'New' } });
      await saving;
      assert.equal(moved.mock.calls.length, 0);
      assert.equal(toastHistory.length, toasts);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('request', () => {
  test('a reply counts only while it is the newest of its kind and the Studio is open', () => {
    const st = studio(), first = st.request('preview'), load = st.request('load');
    const second = st.request('preview');
    assert.deepEqual([first(), second(), load()], [false, true, true]);
    st.back();   // Back to my work overrules a preview on its way
    assert.equal(second(), false);
    st.dispose();
    assert.equal(load(), false);
  });
});
