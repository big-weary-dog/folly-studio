// A new build under an open page (SPEC "Updates", public/js/ui/updates.ts): it reloads by itself only with nothing
// unsaved, and once per build; /build.json changing is what a page notices without a failed load.
import assert from 'node:assert/strict';

import { afterEach, beforeEach, describe, test, vi } from 'vitest';

import { leaveGuard } from '../public/js/ui/session.ts';
import { reloadIfIdle, unsaved, watchBuild } from '../public/js/ui/updates.ts';

type El = { kept?: boolean, value?: string, tag: string };
/** A document with these text controls, `active` the focused one. */
function doc(textareas: El[], active?: El) {
  const el = (e: El) => ({ value: e.value ?? '',
    matches: (sel: string) => (sel === '[data-kept]' ? !!e.kept : sel.includes(e.tag)) });
  return { activeElement: active ? el(active) : null, querySelectorAll: () => textareas.filter((t) => !t.kept).map(el),
    addEventListener() {}, visibilityState: 'visible' } as unknown as Document;
}

let commit = 'aaa', store: Map<string, string>, reload: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  store = new Map();
  reload = vi.fn<() => void>();
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ commit }), { status: 200 }));
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v) });
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('document', doc([]));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete leaveGuard.isDirty;
});

describe('updates', () => {
  test('unsaved: the Studio\'s edits, a field being typed in, or text in a form; not the store\'s own text', () => {
    assert.equal(unsaved(doc([{ tag: 'textarea', kept: true, value: 'code' }])), false);
    assert.equal(unsaved(doc([{ tag: 'textarea', value: '  ' }])), false);
    assert.equal(unsaved(doc([{ tag: 'textarea', value: 'an idea' }])), true);
    assert.equal(unsaved(doc([], { tag: 'input' })), true);
    assert.equal(unsaved(doc([], { tag: 'textarea', kept: true })), false);
    assert.equal(unsaved(doc([], { tag: 'div' })), false);
    leaveGuard.isDirty = () => true;
    assert.equal(unsaved(doc([])), true);
  });

  test('reloads once per build, and never with something unsaved', async () => {
    assert.equal(await reloadIfIdle(), true);
    assert.equal(reload.mock.calls.length, 1);
    assert.equal(await reloadIfIdle(), false, 'the same build again: no loop');
    commit = 'bbb';
    assert.equal(await reloadIfIdle(), true);
    commit = 'ccc';
    leaveGuard.isDirty = () => true;
    assert.equal(await reloadIfIdle(), false);
    assert.equal(reload.mock.calls.length, 2);
  });

  test('no /build.json (a dev server): a failed load still reloads, once', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    assert.equal(await reloadIfIdle(), true);
    assert.equal(await reloadIfIdle(), false);
  });

  test('watchBuild: stale when the served commit changes, checked every few minutes', async () => {
    vi.useFakeTimers();
    commit = 'aaa';
    const stale = vi.fn<() => void>();
    watchBuild(stale);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    assert.equal(stale.mock.calls.length, 0);
    commit = 'bbb';
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    assert.equal(stale.mock.calls.length, 1);
  });
});
