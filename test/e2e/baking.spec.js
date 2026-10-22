// npm run smoke, too: where bakes run (SPEC-baking), on a real render box made library only (no bubblewrap). An admin
// sees it on Admin → Baking and throttles baking; custom code is refused with the reason, at Check & bake (1366) and a
// gallery card's Approve (390); with baking off, Check & bake says an admin turned it off. Screenshots land in
// BAKING_SHOTS when set, else the test's output folder.
import path from 'node:path';

import { createRenderBox } from '../../src/render-box.ts';
import { expect, quiet, test } from './studio.js';

const PEOPLE = 'baking-admin-390,baking-admin-1366';
test.use({ serverOptions: { admins: PEOPLE, curators: PEOPLE,
  renderBox: createRenderBox({ bwrap: 'no-such-bwrap', seconds: 4, log: quiet }) } });

const CUSTOM = 'function pixel(p, t) { return scale([0.2, 0.4, 1], wave(t * 0.25)); }';

for (const width of [390, 1366]) {
  test(`baking at ${width}: the setting, and a refused bake`, async ({ page, studio }, info) => {
    const shot = (name) => page.screenshot({ fullPage: true, path: process.env.BAKING_SHOTS
      ? path.join(process.env.BAKING_SHOTS, `${width}-${name}.png`) : info.outputPath(`${name}.png`) });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width, height: width < 600 ? 844 : 768 });
    const request = page.context().request, put = (url, data) => request.put(studio.origin + url, { data });
    expect((await request.post(`${studio.origin}/api/signup`, { data: { username: `baking-admin-${width}`,
      password: 'correct horse' } })).status()).toBe(201);
    const { look } = await (await request.post(`${studio.origin}/api/looks`, { data: { title: `Custom ${width}`,
      duration: 2, layers: [{ id: 'l1', title: 'Sea', code: `${CUSTOM} // ${width}`, groups: ['cathedral'],
        params: {} }] } })).json();
    expect((await put(`/api/looks/${look.id}`, { shared: true })).ok()).toBe(true);

    await page.goto(`${studio.origin}/admin/baking`);
    await expect(page.getByText(/Library only\. Bubblewrap \(bwrap\) is not installed/)).toBeVisible();
    await page.getByRole('button', { name: 'Throttled' }).click();
    await expect(page.getByText('Baking is throttled.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Throttled' })).toHaveAttribute('aria-pressed', 'true');
    await shot('1-admin-throttled');
    await page.getByRole('button', { name: 'On', exact: true }).click();
    await expect(page.getByText('Baking is on.')).toBeVisible();

    if (width < 600) {
      await page.goto(`${studio.origin}/gallery`);
      const card = page.locator('.card', { hasText: `Custom ${width}` });
      await card.getByRole('button', { name: `Approve Custom ${width}` }).click();
      await expect(page.getByText(/without bubblewrap, so only looks made of unchanged library .* custom code/))
        .toBeVisible();
      await shot('2-refused');
    } else {
      await page.goto(`${studio.origin}/studio/${look.id}`);
      const openBake = async () => {
        await page.getByRole('button', { name: 'Export' }).click();
        await page.getByRole('menuitem', { name: 'Check & bake…' }).click();
      };
      await openBake();
      const bake = page.locator('dialog section.bake');
      await expect(bake).toContainText('so this server bakes only looks made of unchanged library patterns.');
      await bake.getByRole('button', { name: 'Bake', exact: true }).click();
      await expect(bake.locator('.bake-reason').first()).toContainText('Layer 1 (Sea) is custom code.');
      await shot('2-refused');

      expect((await put('/api/admin/baking', { mode: 'off' })).ok()).toBe(true);
      await page.reload();
      await openBake();
      await expect(bake).toContainText('An admin turned baking off, so looks cannot be baked here for now.');
      await expect(bake.getByRole('button', { name: 'Bake', exact: true })).toBeDisabled();
      await shot('3-off');
      expect((await put('/api/admin/baking', { mode: 'on' })).ok()).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
