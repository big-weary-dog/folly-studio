// npm run smoke, too: library only, as on every server (spec/frames "Library only"): the Studio has no code to edit,
// its pickers offer only the library, and a module naming none is refused.
// Screenshots land in CODE_SHOTS when set, else the test's output folder.
import path from 'node:path';

import { expect, signupIn, test } from './studio.js';

for (const width of [390, 1366]) {
  test(`library only at ${width}`, async ({ page, studio }, info) => {
    const wide = width > 600;
    const shot = (name) => page.screenshot({ fullPage: true, path: process.env.CODE_SHOTS
      ? path.join(process.env.CODE_SHOTS, `${width}-${name}.png`) : info.outputPath(`${name}.png`) });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width, height: wide ? 768 : 844 });
    const request = page.context().request;
    await signupIn(request, studio.origin, `code-${width}`);
    const sea = (module) => [{ id: 'l1', title: 'Sea', groups: ['cathedral'], modules: [{ id: 'm1', kind: 'source',
      title: 'Mine', params: {}, ...module }] }];
    const made = await request.post(`${studio.origin}/api/looks`, { data: { title: `Mine ${width}`,
      layers: sea({ ref: 'colour-wash' }) } });
    expect(made.status(), await made.text()).toBe(201);
    const { look } = await made.json();
    await page.goto(`${studio.origin}/studio/${look.id}`);
    await expect(page.locator('.layer-name', { hasText: 'Sea' }).first()).toBeAttached();
    await expect(page.locator('textarea.code, .dock-tab[data-dock=code]')).toHaveCount(0);
    await shot('1-studio');

    if (!wide) await page.locator('.tab[data-tab=layers]').click();
    await page.locator('[data-tour=layers-add]').click();
    const shelf = page.getByRole('dialog', { name: 'Add a layer' });
    await expect(shelf.locator('.shelf-row')).not.toHaveCount(0);
    await expect(shelf.locator('.shelf-row[data-kind=source]').first()).toBeVisible();
    await shot('2-library-only-layer-picker');
    await page.keyboard.press('Escape');
    if (wide) {
      await page.locator('[data-tour=chain-add]').click();
      const modules = page.getByRole('dialog', { name: 'Add a module' });
      for (const kind of ['source', 'warp', 'filter']) {
        await modules.locator(`[data-tour="shelf-tab:${kind}"]`).click();
        await expect(modules.locator(`.shelf-row[data-kind=${kind}]`).first()).toBeVisible();
      }
      await shot('3-library-only-module-picker');
      await page.keyboard.press('Escape');
    }

    const r = await request.post(`${studio.origin}/api/looks`, { data: { title: 'New',
      layers: sea({ ref: 'my-own', code: 'function pixel() { return [1, 1, 1]; }' }) } });
    expect(r.status()).toBe(403);
    expect((await r.json()).error).toMatch(/Layer 1 \(Sea\)'s Mine names my-own, which the library does not have/);
    expect(errors).toEqual([]);
  });
}
