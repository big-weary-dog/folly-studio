// npm run smoke, too: refining a look at a laptop's and a phone's size (SPEC-generators "Refine"). Sketch (offline,
// so an admin's) makes the look and then refines it in words; the Refine box shows what changed, and Undo puts it back.
import { expect, test } from './studio.js';

const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
test.use({ serverOptions: { admins: 'refine-laptop,refine-phone' } });

for (const [name, device] of Object.entries(SIZES)) {
  test.describe(`${name}, ${device.viewport.width} × ${device.viewport.height}`, () => {
    test.use(device);

    test('a look refined in words, what changed shown, and undone', async ({ page, studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const shot = (step) => page.screenshot({ path: info.outputPath(`${step}.png`), timeout: 60_000 });
      await page.goto(`${studio.origin}/login`);
      await page.getByRole('button', { name: 'Sign up' }).click();
      await page.fill('input[name=username]', `refine-${name}`);
      await page.fill('input[name=password]', 'correct horse');
      await page.locator('form button[type=submit]').click();
      await page.fill('textarea.idea-input', 'A slow purple wash over the arches');
      await page.getByRole('button', { name: 'Turn it into a look' }).click();
      await page.getByRole('link', { name: 'Open in Studio' }).first().click({ timeout: 60_000 });
      await expect(page).toHaveURL(/\/studio\/[\w-]+$/);

      if (name === 'laptop') await page.locator('.dock-tab', { hasText: 'Look' }).click();
      else await page.locator('.tab[data-tab=look]').click();
      const box = page.locator('section.refine:visible');
      await expect(box).toBeVisible({ timeout: 30_000 });
      await box.locator('textarea').fill('brighter and faster');
      await box.getByRole('button', { name: 'Refine' }).click();
      await expect(box.locator('.refine-changes li').first()).toBeVisible({ timeout: 30_000 });
      await expect(box.locator('.refine-changes')).toContainText('level');
      await shot('refined');
      await box.getByRole('button', { name: 'Undo' }).click();
      await expect(page.getByText('Put back as it was.')).toBeVisible();
      await expect(box.locator('.refine-changes')).toHaveCount(0);
      await box.locator('textarea').fill('write me a poem');
      await box.getByRole('button', { name: 'Refine' }).click();
      await expect(box.locator('.refine-error')).toContainText('Sketch can');
      await shot('refused');
      expect(errors).toEqual([]);
    });
  });
}
