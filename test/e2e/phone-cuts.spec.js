// Phone authoring cuts preserve playback, palette, faders and sharing at the supported narrow widths.
import path from 'node:path';
import { expect, test } from './studio.js';

for (const width of [360, 390, 430]) {
  test(`Studio phone cuts at ${width}`, async ({ page, studio }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem('studio.tab', 'time');
      localStorage.setItem('studio.phoneDetail', '1');
    });
    const post = (url, data) => page.request.post(studio.origin + url, { data });
    expect((await post('/api/signup', { username: `cuts-${width}`, password: 'correct horse' })).status()).toBe(201);
    const { look } = await (await post('/api/looks', { title: 'Phone performance', layers: [],
      globals: { macros: { energy: { value: 0.5, min: 0, max: 1 } } } })).json();
    await page.goto(`${studio.origin}/studio/${look.id}`);
    const shot = (name) => page.screenshot({ path: process.env.PHONE_CUT_SHOTS
      ? path.join(process.env.PHONE_CUT_SHOTS, `after-${width}-${name}.png`) : info.outputPath(`${name}.png`) });
    await expect(page.locator('.studio')).toHaveAttribute('data-tab', 'layers');
    await expect(page.locator('.studio-tabs .tab')).toHaveText(['Layers', 'Look', 'More']);
    await expect(page.locator('textarea.code,.tl,.pane-time')).toHaveCount(0);
    await expect(page.locator('.pane-viewer')).toHaveCSS('height', '240px');
    await shot('layers');
    await page.locator('.layer-name').first().click();
    await expect(page.locator('.phone-head')).toBeVisible();
    await expect(page.locator('.param-mod')).toHaveCount(0);
    await shot('settings');
    await page.locator('.tab[data-tab=look]').click();
    await expect(page.getByRole('combobox', { name: 'Palette', exact: true })).toBeVisible();
    await expect(page.getByLabel('energy value')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toBeHidden();
    await expect(page.locator('.mini-list,.globals-mods,[data-tour=macro-add]')).toHaveCount(0);
    await shot('look');
    await page.getByText('Share details', { exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Refine with AI', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'What to change' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Critique', exact: true })).toHaveCount(0);
    await page.locator('.tab[data-tab=more]').click();
    await expect(page.getByRole('checkbox', { name: /Show unlit/ })).toBeVisible();
    await expect(page.getByText(/Full detail|Open the code editor/)).toHaveCount(0);
    await shot('more');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
}
