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
      const code = page.getByRole('group', { name: 'Custom code' });
      await code.getByRole('button', { name: 'Off' }).click();
      await expect(page.getByText('Custom code is off.')).toBeVisible();
      await expect(code.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText(/No new code: looks take library modules/)).toBeVisible();
      await shot('1-admin-off');

      await page.goto(`${studio.origin}/studio/${look.id}`);
      if (wide) await page.locator('.dock-tab', { hasText: 'Code' }).click();
      else {
        await page.locator('.tab[data-tab=more]').click();
        await page.getByRole('button', { name: 'Open the code editor' }).click();
      }
      await expect(page.locator('.editor-locked:visible')).toHaveText(/An admin turned custom code off/);
      const editor = page.locator('textarea.code:visible').first();
      await expect(editor).toHaveJSProperty('readOnly', true);
      await expect(editor).toHaveValue(new RegExp(`// ${width}$`));
      await shot('2-studio-locked');

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
