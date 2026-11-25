// Where the app sends each URL, without a browser: routes and redirects for the signed in and out, `next` kept on
// this app, and what a guest or an account starts with (the tutorial's save step, Advanced editing).
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { resolve, safeNext } from '../public/js/ui/app.tsx';
import { advanced, setAdvanced, user } from '../public/js/ui/session.ts';
import { pathsHere } from '../public/js/ui/tour/paths/index.ts';

const where = (path: string, search = '', signedIn = true) => {
  const r = resolve(path, search, signedIn);
  return 'redirect' in r ? `→ ${r.redirect}` : `${r.route.name} ${JSON.stringify(r.params)}`;
};

describe('routing', () => {
  test('the same URLs, with redirects for the signed out and the signed in', () => {
    assert.equal(where('/'), '→ /gallery');
    assert.equal(where('/', '', false), '→ /gallery');
    assert.equal(where('/studio/a%20b'), 'studio {"lookId":"a b"}');
    assert.equal(where('/studio/'), 'studio {}');
    assert.equal(where('/gallery'), 'gallery {}');
    assert.equal(where('/nowhere'), '→ /gallery');
    assert.equal(where('/studio', '?y=1', false), '→ /login?next=%2Fstudio%3Fy%3D1');
    assert.equal(where('/studio/x', '', false), 'studio {"lookId":"x"}', 'a share link is open to visitors');
    assert.equal(where('/gallery', '', false), 'gallery {}');
    assert.equal(where('/login', '?next=%2Fgallery'), '→ /gallery');
    assert.equal(where('/login', '', false), 'auth {}');
    assert.equal(where('/privacy', '', false), 'privacy {}');
    assert.equal(where('/privacy'), 'privacy {}');
  });

  test('the admin pages are tabs under /admin; /admin and their old URLs lead to them', () => {
    assert.equal(where('/admin/light'), 'light {}');
    assert.equal(where('/admin'), '→ /admin/light');
    assert.equal(where('/admin/'), '→ /admin/light');
    assert.equal(where('/admin/models'), '→ /admin/light');
    assert.equal(where('/models'), '→ /admin/light');
    assert.equal(where('/access/'), '→ /admin/light');
    assert.equal(where('/light'), '→ /admin/light');
    assert.equal(where('/reports', '?id=r1'), '→ /admin/reports?id=r1');
    assert.equal(where('/admin/reports', '', false), '→ /login?next=%2Fadmin%2Freports');
  });

  test('Ideas is gone: its URLs lead home, the gallery, a guest\'s too', () => {
    assert.equal(where('/ideas'), '→ /gallery');
    assert.equal(where('/ideas/x/how'), '→ /gallery');
    user.value = { id: 'guest-x', username: 'Wren', role: 'member', guest: true };
    try { assert.equal(where('/'), '→ /gallery'); } finally { user.value = null; }
  });

  test('a guest\'s tutorial says an account saves', () => {
    const save = (guest: boolean) => pathsHere(guest).find((p) => p.id === 'first-look')!.steps
      .find((s) => s.id === 'save')!;
    assert.match(save(true).text, /log in or sign up/);
    assert.doesNotMatch(save(false).text, /log in or sign up/);
  });

  test('Advanced editing: an account starts with it, a guest or visitor without; the browser\'s choice wins', () => {
    const as = (u: typeof user.value) => { user.value = u; return advanced.value; };
    try {
      assert.deepEqual([as(null), as({ id: 'g', username: 'Wren', role: 'member', guest: true }),
        as({ id: 'a', username: 'ann', role: 'member' })], [false, false, true]);
      setAdvanced(false);
      assert.equal(advanced.value, false, 'turned off by an account');
      setAdvanced(true);
      assert.equal(as(null), true, 'turned on in this browser');
    } finally { user.value = null; }
  });

  test('`next` stays on this app', () => {
    for (const bad of [null, '', 'https://evil.example', '//evil.example', '/login?next=/x']) {
      assert.equal(safeNext(bad), '/gallery', String(bad));
    }
    assert.equal(safeNext('/studio/abc?x=1'), '/studio/abc?x=1');
  });
});
