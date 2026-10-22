// npm run smoke, too: Admin → Stats (SPEC-access "Stats") at a laptop's and a phone's size: today's counts after a
// few page loads, the days' table, the server line, and Refresh. Screenshots land in STATS_SHOTS when set, else the
// test's output folder.
import path from 'node:path';

import { expect, test } from './studio.js';

test.use({ serverOptions: { admins: 'stats-admin-390,stats-admin-1366' } });

for (const width of [390, 1366]) {
  test(`stats at ${width}`, async ({ page, studio }, info) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width, height: width < 600 ? 844 : 768 });
    const request = page.context().request;
    expect((await request.post(`${studio.origin}/api/signup`, { data: { username: `stats-admin-${width}`,
      password: 'correct horse' } })).status()).toBe(201);
    await page.goto(`${studio.origin}/gallery`);
    await page.goto(`${studio.origin}/admin/stats`);
    const tiles = page.getByRole('definition');
    await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible();
    await expect(page.locator('.stats-tile', { hasText: 'Visitors' }).getByRole('definition')).not.toHaveText('0');
    await expect(page.locator('.stats-tile', { hasText: 'Pages' }).getByRole('definition')).not.toHaveText('0');
    await expect(page.getByText(/^Up \d+ min/)).toBeVisible();
    await expect(page.locator('.stats-table tbody tr')).toHaveCount(1);
    const before = Number(await page.locator('.stats-tile', { hasText: 'Requests' }).getByRole('definition')
      .textContent());
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.locator('.stats-tile', { hasText: 'Requests' }).getByRole('definition'))
      .not.toHaveText(String(before));
    await expect(page.locator('[data-tab=stats]')).toHaveAttribute('aria-current', 'page');
    expect(await tiles.count()).toBe(6);
    await page.screenshot({ fullPage: true, path: process.env.STATS_SHOTS
      ? path.join(process.env.STATS_SHOTS, `stats-${width}.png`) : info.outputPath('stats.png') });
    expect(errors).toEqual([]);
  });
}
