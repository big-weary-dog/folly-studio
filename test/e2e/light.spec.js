// npm run smoke, too: phone omits calibration and files; laptop lets an admin calibrate the response,
// the screen row follows it at once while the bytes stay; the output gamma moves both; a save keeps them, and they
// download as light.json.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { SIZES } from './sizes.js';
import { expect, signupIn, test } from './studio.js';

test.use({ serverOptions: { admins: 'light-laptop,light-phone' } });

for (const [name, device] of Object.entries(SIZES)) {
  test.describe(`${name}, ${device.viewport.width} × ${device.viewport.height}`, () => {
    test.use(device);

    test('a member opening Admin directly sees an explanation without settings', async ({ page, studio }, info) => {
      const request = page.context().request;
      await signupIn(request, studio.origin, `member-${name}`);
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
      await signupIn(page.request, studio.origin, `light-${name}`);
      await page.goto(`${studio.origin}/admin/light`);
      if (name === 'phone') {
        await expect(page.getByText('Light calibration and file tools are available on a laptop.')).toBeVisible();
        await expect(page.getByRole('spinbutton')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Download light.json' })).toHaveCount(0);
        await page.getByRole('combobox', { name: 'Admin page' }).selectOption('baking');
        await expect(page.getByRole('group', { name: 'Baking', exact: true })).toBeVisible();
        expect(errors).toEqual([]);
        return;
      }
      const response = page.getByRole('spinbutton', { name: 'Response' });
      const gamma = page.getByRole('spinbutton', { name: 'Output gamma' });
      const row = (i) => page.locator('.light-curve tbody tr').nth(i).locator('td').nth(2);   // the 50 % column
      const [sends, screen] = [row(0), row(2)];
      await expect(response).toHaveValue(/^1\.00/);   // the other size's run may have saved; it puts 1 back below
      await expect(gamma).toHaveValue(/^2\.65/);
      await expect(sends).toHaveText('41');            // 50 % at gamma 2.65: 41 of 255
      await expect(screen).toHaveText('103');
      await page.screenshot({ path: process.env.ADMIN_SHOTS
        ? path.join(process.env.ADMIN_SHOTS, `${device.viewport.width}-light-admin.png`)
        : info.outputPath('light.png'), fullPage: true });

      await response.fill('2');
      await response.press('Enter');
      await expect(screen).toHaveText('40');          // (0.5^2.65)² of the light: 2.5 %
      await expect(sends).toHaveText('41');
      await gamma.fill('1');
      await gamma.press('Enter');
      await expect(page.getByRole('button', { name: 'Download light.json' })).toBeDisabled();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole('spinbutton')).toHaveCount(0);
      await page.setViewportSize(device.viewport);
      await expect(response).toHaveValue(/^2\.00/);
      await expect(gamma).toHaveValue(/^1\.00/);
      await expect(page.getByRole('button', { name: 'Download light.json' })).toBeDisabled();
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
      await page.getByRole('button', { name: 'Download light.json' }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe('light.json');
      const saved = JSON.parse(readFileSync(await file.path(), 'utf8'));
      expect([saved.gamma, saved.calibration.response]).toEqual([1, 2]);

      await page.getByRole('button', { name: 'Defaults' }).click();
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(response).toHaveValue(/^1\.00/);
      await expect(gamma).toHaveValue(/^2\.65/);
      expect(errors).toEqual([]);
    });
  });
}
