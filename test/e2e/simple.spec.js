// npm run smoke, too: the Studio on a laptop is Simple for a guest (SPEC-studio "Simple"): no Timeline tab, no ∿,
// Export's menu only what shows, by keyboard too; the user menu's Advanced editing brings the rest back. A guest
// plays the tutorial in Simple by its own controls.
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

test('a guest plays Getting around in Simple, each step by its control', async ({ page, studio }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  expect((await page.request.post(`${studio.origin}/api/guest`, { data: {} })).status()).toBe(201);
  await page.goto(`${studio.origin}/studio`);
  await expect(page.locator('li.layer')).toHaveCount(1, { timeout: 60_000 });
  await page.locator('#user-menu-btn').click();
  await page.getByRole('button', { name: 'Tutorials' }).click();
  await page.locator('.tour-path', { hasText: 'Getting around' }).click();
  const card = page.locator('.tour-step'), at = (name) => page.locator(`[data-tour~="${name}"]`);
  const open = (title) => expect(card.locator('h2')).toHaveText(title, { timeout: 30_000 });

  await open('Pause and play');
  await at('play').click();
  await expect(at('play')).toHaveAttribute('aria-label', 'Play');
  await at('play').click();
  await open('Its layers');
  await at('layer:arches').locator('.layer-name').click();
  await open('A colour');
  if (!await at('param:colours').isVisible()) await at('module:single-strand').click();
  await at('param:colours').locator('.pick-btn').click();
  await page.locator('.pick-pop:popover-open').locator('.pick-whole', { hasText: /^high$/ }).locator('input').check();
  await page.keyboard.press('Escape');
  await open('Mute');
  await at('mute:starfield').click();
  await expect(at('mute:starfield')).toHaveAttribute('aria-pressed', 'true');
  await at('mute:starfield').click();
  await open('Keep your work');
  await expect(at('save')).toBeVisible();
  await card.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('dialog', { name: 'Getting around: done' })).toBeVisible();
  await expect(page.locator('.dock-tab[data-dock=timeline]')).toHaveCount(0);   // still Simple
  expect(errors).toEqual([]);
});
