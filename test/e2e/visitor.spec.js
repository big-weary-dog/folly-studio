// npm run smoke, too: a visitor, with no session (SPEC-access "Visitors"), at a laptop's and a phone's size. `/` is
// the gallery; a share link opens the look in the Studio, theirs to play with; Try it lets them in as a guest on the
// spot, their edits kept.
import { expect, signup, test } from './studio.js';

const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

/** An approved look of `owner`'s: shared, and marked reviewed in the store (no bake needed to open it). */
async function approvedLook(studio, owner) {
  const cookie = await signup(studio.origin, owner);
  const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST', headers: { cookie,
    'content-type': 'application/json' }, body: JSON.stringify({ title: `Shared by ${owner}`, shared: true,
    layers: [{ id: 'l1', title: 'Wash', groups: ['cathedral'], blend: 'add', level: 1,
      modules: [{ id: 'm1', kind: 'source', ref: 'colour-wash' }] }] }) });
  expect(res.status).toBe(201);
  const { look } = await res.json();
  studio.app.store.looks.update(look.id, { reviewed: true });
  return look;
}

for (const [name, device] of Object.entries(SIZES)) {
  test.describe(`${name}, ${device.viewport.width} × ${device.viewport.height}`, () => {
    test.use(device);

    test('a visitor sees the gallery, opens a share link, edits, and Try it keeps it', async ({ page, studio }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const look = await approvedLook(studio, `visited-${name}`), layers = page.locator('li.layer');

      await page.goto(`${studio.origin}/`);
      await expect(page).toHaveURL(`${studio.origin}/gallery`);
      await expect(page.locator('.card', { hasText: look.title })).toBeVisible({ timeout: 30_000 });

      await page.goto(`${studio.origin}/studio/${look.id}`);
      await expect(layers).toHaveCount(1, { timeout: 60_000 });
      await page.getByRole('button', { name: 'Duplicate layer' }).click();
      await expect(layers).toHaveCount(2);

      await page.getByRole('button', { name: 'Try it', exact: true }).click();
      await expect(page.locator('.user-box .tag')).toHaveText('Guest');
      await expect(page).toHaveURL(`${studio.origin}/studio/${look.id}`);
      await expect(layers).toHaveCount(2);
      expect(errors).toEqual([]);
    });
  });
}
