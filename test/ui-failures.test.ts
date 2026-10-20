// When something fails in the browser: a look whose save fails is never shared (studio-store's setShared), so the
// gallery never gets an older copy than the one on screen; a lazy part that fails to load says so (kit's lazy).
import assert from 'node:assert/strict';

import { describe, test, vi } from 'vitest';

Object.assign(globalThis, { matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) });
const { api } = await import('../public/js/api.ts');
const { createStudio } = await import('../public/js/ui/studio-store.ts');
const { lazy, toastHistory } = await import('../public/js/ui/kit.tsx');

describe('Share after a save', () => {
  test('a failed save stops the share and says why', async () => {
    const st = createStudio(null), calls: object[] = [];
    st.look.value = { ...st.look.value, id: 'look-1', title: 'Edited' };
    st.ready.value = true;                          // saved is still '': the look has unsaved edits
    Object.assign(api, { updateLook: async (_id: string, body: object) => {
      calls.push(body);
      throw new Error('the server is down');
    } });
    assert.equal(await st.save(), false);
    await st.setShared(true);
    assert.equal(calls.length, 2, 'two saves tried, no share sent');
    assert.ok(calls.every((b) => !('shared' in b)));
    assert.equal(toastHistory.at(-1)?.message, 'Could not save: the server is down');
  });
});

describe('Lazy parts', () => {
  test('a part that fails to load says so once, and what waits on it never runs', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      let ran = 0;
      const load = lazy(() => Promise.reject(new Error('chunk gone')));
      void load().then(() => ran++);
      void load().then(() => ran++);
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(ran, 0);
      assert.equal(toastHistory.filter((t) => /Reload/.test(t.message)).length, 1);
      assert.equal(await lazy(async () => 7)(), 7);
    } finally { quiet.mockRestore(); }
  });
});
