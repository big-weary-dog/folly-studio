// npm run smoke, too: the Studio on a laptop is Simple for a guest (SPEC-studio "Simple"): no Timeline tab, no ∿,
// Export's menu only what shows, by keyboard too; the user menu's Advanced editing brings the rest back.
import { expect, test } from './studio.js';

test.use({ viewport: { width: 1366, height: 768 } });

test('a guest\'s Studio is Simple until Advanced editing is on', async ({ page, studio }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  expect((await page.request.post(`${studio.origin}/api/guest`, { data: {} })).status()).toBe(201);
  await page.goto(`${studio.origin}/studio`);
  await expect(page.locator('li.layer')).toHaveCount(1, { timeout: 60_000 });
  const timeline = page.locator('.dock-tab[data-dock=timeline]'), mods = page.locator('.pane-params .param-mod');

  await expect(timeline).toHaveCount(0);
  await expect(page.locator('.palette-select')).toBeVisible();
  await expect(mods.first()).toBeHidden();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const items = page.getByRole('menuitem');
  await expect(items).toHaveText(['Check & bake…', 'Export look JSON']);
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('Escape');

  await page.locator('#user-menu-btn').click();
  await page.getByRole('button', { name: 'Advanced editing' }).click();
  await expect(timeline).toBeVisible();
  await expect(mods.first()).toBeVisible();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(items).toHaveText(['Export .fseq…', 'Check & bake…', 'Export look JSON']);
  await page.reload();
  await expect(timeline).toBeVisible({ timeout: 60_000 });   // kept in this browser
  expect(errors).toEqual([]);
});
