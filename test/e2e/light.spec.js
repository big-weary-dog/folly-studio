// npm run smoke, too: the Light page in a browser at a laptop's and a phone's size. An admin calibrates the response,
// the screen row follows it at once while the bytes stay; the output gamma moves both; a save keeps them, and the
// Pi's copy downloads as light.json.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './studio.js';

const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
test.use({ serverOptions: { admins: 'light-laptop,light-phone' } });

for (const [name, device] of Object.entries(SIZES)) {
  test.describe(`${name}, ${device.viewport.width} × ${device.viewport.height}`, () => {
    test.use(device);

    test('a member opening Admin directly sees an explanation without settings', async ({ page, studio }, info) => {
      const request = page.context().request;
      expect((await request.post(`${studio.origin}/api/signup`, { data: { username: `member-${name}`,
        password: 'correct horse' } })).status()).toBe(201);
      const writes = [];
      page.on('request', (r) => { if (r.method() === 'PUT') writes.push(r.url()); });
      for (const tab of ['light', 'baking']) {
        await page.goto(`${studio.origin}/admin/${tab}`);
        await expect(page.getByRole('heading', { name: 'Admin access required' })).toBeVisible();
        await expect(page.getByText('You need an admin account to view or change these settings.')).toBeVisible();
        await expect(page.locator('.admin-tabs, .models-panel, .models-actions')).toHaveCount(0);
        await expect(page.getByRole('spinbutton')).toHaveCount(0);
        await page.screenshot({ fullPage: true, path: process.env.ADMIN_SHOTS
          ? path.join(process.env.ADMIN_SHOTS, `${device.viewport.width}-${tab}-member.png`)
          : info.outputPath(`${tab}-member.png`) });
        expect((await request.put(`${studio.origin}/api/admin/${tab}`, {
          data: tab === 'light' ? { gamma: 1 } : { mode: 'off' },
        })).status()).toBe(403);
      }
      expect(writes).toEqual([]);
    });

    test('an admin calibrates the response and sets the gamma; the screen follows, a save keeps it', async ({ page,
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
      const gamma = page.getByRole('spinbutton', { name: 'Output gamma' });
      const row = (i) => page.locator('.light-curve tbody tr').nth(i).locator('td').nth(2);   // the 50 % column
      const [sends, screen] = [row(0), row(2)];
      await expect(response).toHaveValue(/^1\.00/);   // the other size's run may have saved; it puts 1 back below
      await expect(gamma).toHaveValue(/^2\.20/);
      await expect(sends).toHaveText('55');            // 50 % at gamma 2.2: 55 of 255
      await expect(screen).toHaveText('119');
      await page.screenshot({ path: process.env.ADMIN_SHOTS
        ? path.join(process.env.ADMIN_SHOTS, `${device.viewport.width}-light-admin.png`)
        : info.outputPath('light.png'), fullPage: true });

      await response.fill('2');
      await response.press('Enter');
      await expect(screen).toHaveText('57');          // (0.5^2.2)² of the light: 4.7 %
      await expect(sends).toHaveText('55');
      await gamma.fill('1');
      await gamma.press('Enter');
      await expect(page.getByRole('button', { name: 'Download for the Pi' })).toBeDisabled();
      await page.locator('.admin-tabs').getByRole('link', { name: 'Baking' }).click();
      const leave = page.getByRole('dialog', { name: 'Unsaved changes' });
      await expect(leave).toBeVisible();
      await leave.getByRole('button', { name: 'Cancel' }).click();
      await expect(gamma).toHaveValue(/^1\.00/);
      await expect(sends).toHaveText('128');          // gamma 1: the value as it is
      await expect(screen).toHaveText('127');         // (0.5^1)² of the light: 25 %
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Light settings saved.')).toBeVisible();
      await page.reload();
      await expect(response).toHaveValue(/^2\.00/);
      await expect(gamma).toHaveValue(/^1\.00/);

      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download for the Pi' }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe('light.json');
      const pi = JSON.parse(readFileSync(await file.path(), 'utf8'));
      expect([pi.gamma, pi.calibration.response]).toEqual([1, 2]);

      await page.getByRole('button', { name: 'Defaults' }).click();
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(response).toHaveValue(/^1\.00/);
      await expect(gamma).toHaveValue(/^2\.20/);
      expect(errors).toEqual([]);
    });
  });
}
