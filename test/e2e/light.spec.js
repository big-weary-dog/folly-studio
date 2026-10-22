// npm run smoke, too: the Light page in a browser at a laptop's and a phone's size. An admin calibrates the response,
// the screen row follows it at once while the bytes stay, a save keeps it, and the Pi's copy downloads as light.json.
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

    test('an admin calibrates the response; the screen follows, the bytes stay, a save keeps it', async ({ page,
      studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${studio.origin}/login`);
      await page.getByRole('button', { name: 'Sign up' }).click();
      await page.fill('input[name=username]', `light-${name}`);
      await page.fill('input[name=password]', 'correct horse');
      await page.locator('form button[type=submit]').click();
      await expect(page.locator('textarea.idea-input')).toBeVisible({ timeout: 20_000 });

      await page.goto(`${studio.origin}/admin/light`);
      const response = page.getByRole('spinbutton', { name: 'Response' });
      const row = (i) => page.locator('.light-curve tbody tr').nth(i).locator('td').nth(2);   // the 50 % column
      const [sends, screen] = [row(0), row(2)];
      await expect(page.getByRole('spinbutton', { name: 'Gamma' })).toHaveCount(0);   // the Pi's, shown, not edited
      await expect(response).toHaveValue(/^1\.00/);   // the other size's run may have saved; it puts 1 back below
      await expect(sends).toHaveText('55');            // 50 % at gamma 2.2: 55 of 255
      await expect(screen).toHaveText('119');
      await page.screenshot({ path: info.outputPath('light.png'), fullPage: true });

      await response.fill('2');
      await response.press('Enter');
      await expect(screen).toHaveText('57');          // (0.5^2.2)² of the light: 4.7 %
      await expect(sends).toHaveText('55');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Light settings saved.')).toBeVisible();
      await page.reload();
      await expect(response).toHaveValue(/^2\.00/);

      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download for the Pi' }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe('light.json');
      const pi = JSON.parse(readFileSync(await file.path(), 'utf8'));
      expect([pi.gamma, pi.calibration.response]).toEqual([2.2, 2]);

      await page.getByRole('button', { name: 'Defaults' }).click();
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(response).toHaveValue(/^1\.00/);
      expect(errors).toEqual([]);
    });
  });
}
