// npm run smoke, too: the Custom code switch (SPEC-baking "Custom code"). An admin turns it off on Admin → Baking; the
// Studio's code editor goes read only and says why, and a save of new code is refused. Screenshots land in
// CODE_SHOTS when set, else the test's output folder.
import path from 'node:path';

import { expect, test } from './studio.js';

const PEOPLE = 'code-admin-390,code-admin-1366';
test.use({ serverOptions: { admins: PEOPLE } });

const CUSTOM = 'function pixel(p, t) { return scale([0.2, 0.4, 1], wave(t * 0.25)); }';

for (const width of [390, 1366]) {
  test(`custom code at ${width}: the switch, and a read-only editor`, async ({ page, studio }, info) => {
    const wide = width > 600;
    const shot = (name) => page.screenshot({ fullPage: true, path: process.env.CODE_SHOTS
      ? path.join(process.env.CODE_SHOTS, `${width}-${name}.png`) : info.outputPath(`${name}.png`) });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width, height: wide ? 768 : 844 });
    const request = page.context().request, put = (url, data) => request.put(studio.origin + url, { data });
    expect((await request.post(`${studio.origin}/api/signup`, { data: { username: `code-admin-${width}`,
      password: 'correct horse' } })).status()).toBe(201);
    const { look } = await (await request.post(`${studio.origin}/api/looks`, { data: { title: `Mine ${width}`,
      layers: [{ id: 'l1', title: 'Sea', code: `${CUSTOM} // ${width}`, groups: ['cathedral'], params: {} }] } }))
      .json();
    try {
      await page.goto(`${studio.origin}/admin/baking`);
      if (!wide) await page.getByText('Baking details', { exact: true }).click();
      const code = page.getByRole('group', { name: 'Custom code' });
      await code.getByRole('button', { name: 'Off' }).click();
      await expect(page.getByText('Custom code is off.')).toBeVisible();
      await expect(code.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText(/No new code: looks take library modules/)).toBeVisible();
      await shot('1-admin-off');

      await page.goto(`${studio.origin}/studio/${look.id}`);
      if (wide) {
        await page.locator('.dock-tab', { hasText: 'Code' }).click();
        await expect(page.locator('.editor-locked:visible')).toHaveText(/An admin turned custom code off/);
        const editor = page.locator('textarea.code:visible').first();
        await expect(editor).toHaveJSProperty('readOnly', true);
        await expect(editor).toHaveValue(new RegExp(`// ${width}$`));
      } else {
        await page.locator('.tab[data-tab=more]').click();
        await expect(page.getByRole('button', { name: 'Open the code editor' })).toHaveCount(0);
        await expect(page.locator('textarea.code')).toHaveCount(0);
      }
      await shot('2-studio-locked');

      if (!wide) await page.locator('.tab[data-tab=layers]').click();
      await page.locator('[data-tour=layers-add]').click();
      const shelf = page.getByRole('dialog', { name: 'Add a layer' });
      await expect(shelf.getByText(/Choose a library module or preset/)).toBeVisible();
      await expect(shelf.locator('.shelf-row.blank')).toHaveCount(0);
      await expect(shelf.locator('.shelf-row[data-kind=source]').first()).toBeVisible();
      await shot('3-library-only-layer-picker');
      await page.keyboard.press('Escape');
      if (wide) {
        await page.locator('[data-tour=chain-add]').click();
        const modules = page.getByRole('dialog', { name: 'Add a module' });
        for (const kind of ['source', 'warp', 'filter']) {
          await modules.locator(`[data-tour="shelf-tab:${kind}"]`).click();
          await expect(modules.locator('.shelf-row.blank')).toHaveCount(0);
          await expect(modules.locator(`.shelf-row[data-kind=${kind}]`).first()).toBeVisible();
        }
        await shot('4-library-only-module-picker');
        await page.keyboard.press('Escape');
      }

      const r = await request.post(`${studio.origin}/api/looks`, { data: { title: 'New', layers: [{ id: 'l1',
        title: 'Sea', code: `${CUSTOM} // new`, groups: ['cathedral'], params: {} }] } });
      expect(r.status()).toBe(403);
      expect((await r.json()).error).toMatch(/Layer 1 \(Sea\) is new code/);
    } finally {
      expect((await put('/api/admin/baking', { customCode: true })).ok()).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
