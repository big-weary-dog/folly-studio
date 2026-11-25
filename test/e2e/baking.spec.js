// npm run smoke, too: where bakes run (spec/frames "Where bakes run"), on a real render box. An admin sees on Admin →
// Baking that it runs and throttles baking; with baking off, Check & bake (1366) says an admin turned it off.
// Screenshots land in BAKING_SHOTS when set, else the test's output folder.
import path from 'node:path';

import { createRenderBox } from '../../src/render-box.ts';
import { quiet } from '../fixtures/quiet.js';
import { expect, signupIn, test } from './studio.js';

const PEOPLE = 'baking-admin-390,baking-admin-1366';
test.use({ serverOptions: { admins: PEOPLE, curators: PEOPLE,
  renderBox: createRenderBox({ seconds: 4, log: quiet }) } });

for (const width of [390, 1366]) {
  test(`baking at ${width}: the setting, and baking off`, async ({ page, studio }, info) => {
    const shot = (name) => page.screenshot({ fullPage: true, path: process.env.BAKING_SHOTS
      ? path.join(process.env.BAKING_SHOTS, `${width}-${name}.png`) : info.outputPath(`${name}.png`) });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width, height: width < 600 ? 844 : 768 });
    const request = page.context().request, put = (url, data) => request.put(studio.origin + url, { data });
    await signupIn(request, studio.origin, `baking-admin-${width}`);
    const { look } = await (await request.post(`${studio.origin}/api/looks`, { data: { title: `Wash ${width}`,
      duration: 2, layers: [{ id: 'l1', title: 'Sea', groups: ['cathedral'],
        modules: [{ id: 'm1', kind: 'source', ref: 'colour-wash' }] }] } })).json();

    await page.goto(`${studio.origin}/admin/baking`);
    const runs = page.getByText('The render box runs on this server.');
    if (width < 900) {
      await expect(runs).toBeHidden();
      await page.getByText('Baking details', { exact: true }).click();
    }
    await expect(runs).toBeVisible();
    await page.getByRole('button', { name: 'Throttled' }).click();
    await expect(page.getByText('Baking is throttled.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Throttled' })).toHaveAttribute('aria-pressed', 'true');
    await shot('1-admin-throttled');
    await page.getByRole('group', { name: 'Baking' }).getByRole('button', { name: 'On', exact: true }).click();
    await expect(page.getByText('Baking is on.')).toBeVisible();

    if (width >= 600) {
      expect((await put('/api/admin/baking', { mode: 'off' })).ok()).toBe(true);
      await page.goto(`${studio.origin}/studio/${look.id}`);
      await page.getByRole('button', { name: 'Export' }).click();
      await page.getByRole('menuitem', { name: 'Check & bake…' }).click();
      const bake = page.locator('dialog section.bake');
      await expect(bake).toContainText('An admin turned baking off, so looks cannot be baked here for now.');
      await expect(bake.getByRole('button', { name: 'Bake', exact: true })).toBeDisabled();
      await shot('2-off');
      expect((await put('/api/admin/baking', { mode: 'on' })).ok()).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
