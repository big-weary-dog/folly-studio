// npm run smoke, too: the Light page in a browser at a laptop's and a phone's size. An admin changes the gamma, the
// curve table follows it at once, a save keeps it, and the Pi's copy downloads as light.json.
import { readFileSync } from 'node:fs';

import { expect, test } from './studio.js';

const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
test.use({ serverOptions: { admins: 'light-laptop,light-phone' } });

for (const [name, device] of Object.entries(SIZES)) {
  test.describe(`${name}, ${device.viewport.width} × ${device.viewport.height}`, () => {
    test.use(device);

    test('an admin tunes the gamma; the curve follows, a save keeps it, the Pi gets the file', async ({ page, studio },
      info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${studio.origin}/login`);
      await page.getByRole('button', { name: 'Sign up' }).click();
      await page.fill('input[name=username]', `light-${name}`);
      await page.fill('input[name=password]', 'correct horse');
      await page.locator('form button[type=submit]').click();
      await expect(page.locator('textarea.idea-input')).toBeVisible({ timeout: 20_000 });

      await page.goto(`${studio.origin}/light`);
      const gamma = page.getByRole('spinbutton', { name: 'Gamma' });
      const sends = page.locator('.light-curve tbody tr').first();
      await expect(gamma).toHaveValue(/^2\.2/);   // the other size's run may have saved; it puts 2.2 back below
      await expect(sends).toContainText('55');    // 50 % at gamma 2.2: 55 of 255
      await page.screenshot({ path: info.outputPath('light.png'), fullPage: true });

      await gamma.fill('1');
      await gamma.press('Enter');
      await expect(sends.locator('td').nth(2)).toHaveText('128');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Light settings saved.')).toBeVisible();
      await page.reload();
      await expect(gamma).toHaveValue(/^1\.00/);

      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download for the Pi' }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe('light.json');
      expect(JSON.parse(readFileSync(await file.path(), 'utf8')).gamma).toBe(1);

      await page.getByRole('button', { name: 'Defaults' }).click();
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(gamma).toHaveValue(/^2\.2/);
      expect(errors).toEqual([]);
    });
  });
}
