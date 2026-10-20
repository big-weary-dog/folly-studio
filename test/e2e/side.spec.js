// npm run smoke, too: the Studio's side at a laptop's size. Layers and Settings split the column; each expands to
// take it all (the other folds to its head) or collapses to its head, by its buttons or a click on its head; the
// divider sizes the split; the view is kept per browser. Screenshots of each land in the test's output folder.
import { expect, test } from './studio.js';

// An admin: Sketch, the one model here (studio.js), is offered to admins alone.
test.use({ viewport: { width: 1366, height: 768 }, serverOptions: { admins: 'side-laptop' } });

test('layers and settings expand, collapse, resize and stay so', async ({ page, studio }, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const shot = (step) => page.screenshot({ path: info.outputPath(`${step}.png`), timeout: 60_000 });
  await page.goto(`${studio.origin}/login`);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.fill('input[name=username]', 'side-laptop');
  await page.fill('input[name=password]', 'correct horse');
  await page.locator('form button[type=submit]').click();
  await page.fill('textarea.idea-input', 'Rising embers drift up the spires while the rose window glows');
  await page.getByRole('button', { name: 'Turn it into a look' }).click();
  await page.getByRole('link', { name: 'Open in Studio' }).first().click({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/studio\/[\w-]+$/);

  const side = page.locator('.side'), list = page.locator('.layer-list'), params = page.locator('.params-wrap');
  await expect(list).toBeVisible({ timeout: 30_000 });
  await expect(params).toBeVisible();
  await shot('1-normal');

  await page.getByRole('button', { name: 'Expand Layers to the whole column' }).click();
  await expect(side).toHaveAttribute('data-side', 'layers');
  await expect(params).toBeHidden();
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await shot('2-layers-expanded');

  await page.getByRole('button', { name: 'Expand Settings to the whole column' }).click();
  await expect(list).toBeHidden();
  await expect(params).toBeVisible();
  await shot('3-settings-expanded');

  await page.getByRole('button', { name: 'Restore Layers and Settings' }).click();
  await expect(side).toHaveAttribute('data-side', 'split');
  await settings.click();          // its title folds it
  await expect(params).toBeHidden();
  await expect(list).toBeVisible();
  await shot('4-settings-collapsed');
  await page.reload();
  await expect(side).toHaveAttribute('data-side', 'layers');
  await page.locator('.pane-params .pane-head').click({ position: { x: 150, y: 10 } });   // so does its bare head
  await expect(params).toBeVisible();

  const bar = page.locator('.side-divider'), box = await bar.boundingBox();
  const before = (await page.locator('.pane-layers').boundingBox()).height;
  await page.mouse.move(box.x + box.width / 2, box.y + 3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 120, { steps: 4 });
  await page.mouse.up();
  expect((await page.locator('.pane-layers').boundingBox()).height).toBeGreaterThan(before + 80);
  await shot('5-resized');
  for (const width of [1366, 1100]) {     // the heads fit the side: nothing pushed out of sight
    await page.setViewportSize({ width, height: 768 });
    for (const head of await page.locator('.side .pane-head').all()) {
      expect(await head.evaluate((h) => h.scrollWidth - h.clientWidth)).toBe(0);
    }
  }
  await shot('6-at-1100');
  expect(errors).toEqual([]);
});
