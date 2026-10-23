// A guest's work (SPEC-access "Guests"): an account's blank Studio opens the copy kept in this browser, and the copy
// stays until that account saves or discards it, so a Studio that fails to load loses nothing.
import assert from 'node:assert/strict';

import { computed, signal } from '@preact/signals';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { adoptGuestWork, guestWork } from '../public/js/ui/guest-work.ts';
import { user } from '../public/js/ui/session.ts';

const KEY = 'folly-guest-work', work = { title: 'Mine', layers: [{ id: 'a' }] };
let kept;
beforeEach(() => {
  kept = new Map([[KEY, JSON.stringify(work)]]);
  vi.stubGlobal('localStorage', { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v),
    removeItem: (k) => kept.delete(k) });
  user.value = { id: 'ada', name: 'ada' };
});
afterEach(() => { vi.unstubAllGlobals(); user.value = null; });

test('an account opening the work keeps the copy until its Studio saves it', async () => {
  assert.equal(guestWork()?.title, 'Mine');
  assert.ok(kept.has(KEY), 'opening is not adopting: a Studio that fails to load finds it again');
  const body = signal('{"edited":1}'), saved = signal(''), ready = signal(true);
  const st = { saved, ready, dirty: computed(() => ready.value && body.value !== saved.value) };
  adoptGuestWork(st);
  await Promise.resolve();
  assert.equal(st.dirty.value, true, 'unsaved in the account’s Studio');
  assert.ok(kept.has(KEY));
  saved.value = body.value;   // saved, or discarded on leaving
  assert.equal(kept.has(KEY), false);
});
