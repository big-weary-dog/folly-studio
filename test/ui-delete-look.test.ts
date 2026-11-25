// Who gets a look's Delete (public/js/ui/gallery/delete-look.ts).
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { mayDelete } from '../public/js/ui/gallery/delete-look.ts';

describe('who gets a look\'s Delete (delete-look.ts)', () => {
  const [member, curator, admin] = (['member', 'curator', 'admin'] as const).map((role) => ({ id: role, role }));
  const look = (owner: string, shared = true) => ({ id: 'l', title: 'Embers', owner, shared });
  test('the gallery: admins only, on any shared look; My looks: the owner', () => {
    assert.deepEqual([member, curator, admin].map((u) => mayDelete(u, look('other'), true)), [false, false, true]);
    assert.equal(mayDelete(member, look('member'), true), false, 'not their own, from the gallery');
    assert.equal(mayDelete(admin, look('admin'), true), true);
    assert.equal(mayDelete(member, look('member', false), false), true, 'My looks');
    assert.equal(mayDelete(admin, look('other', false), true), false, 'never an unshared look');
  });
});
