// Phone authoring cuts preserve playback, palette, faders and sharing at the supported narrow widths.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, test } from './studio.js';

const code = (ref) => readFileSync(new URL(`../../public/patterns/${ref}.js`, import.meta.url), 'utf8');

for (const width of [360, 390, 430]) {
  test(`Studio phone cuts at ${width}`, async ({ page, studio }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem('studio.tab', 'time');
      localStorage.setItem('studio.phoneDetail', '1');
    });
    await page.goto(`${studio.origin}/login`);
    await expect(page.locator('.auth-art')).toBeHidden();
    await expect(page.locator('.auth-lede')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Guest', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toBeVisible();
    const post = (url, data) => page.request.post(studio.origin + url, { data });
    expect((await post('/api/signup', { username: `cuts-${width}`, password: 'correct horse' })).status()).toBe(201);
    const { access } = await (await post('/api/invite', {
      code: studio.app.access.createInvite('phone-fixture', { uses: 1 }).code })).json();
    expect([access.unlocked, access.exempt]).toEqual([true, false]);
    const { look } = await (await post('/api/looks', { title: 'Phone performance', layers: [{
      id: 'rose', title: 'Rose', modules: [
        { id: 'bars', title: 'Bars', kind: 'source', ref: 'bars', code: code('bars') },
        { id: 'hue', title: 'Hue shift', kind: 'filter', ref: 'hue-shift', code: code('hue-shift') },
      ],
    }],
      globals: { macros: { energy: { value: 0.5, min: 0, max: 1 } } } })).json();
    await page.goto(`${studio.origin}/studio/${look.id}`);
    const shot = (name) => page.screenshot({ path: process.env.PHONE_CUT_SHOTS
      ? path.join(process.env.PHONE_CUT_SHOTS, `after-${width}-${name}.png`) : info.outputPath(`${name}.png`) });
    await expect(page.locator('.studio')).toHaveAttribute('data-tab', 'layers');
    await expect(page.locator('.studio-tabs .tab')).toHaveText(['Layers', 'Look', 'More']);
    await expect(page.locator('textarea.code,.tl,.pane-time')).toHaveCount(0);
    await expect(page.locator('.pane-viewer')).toHaveCSS('height', '240px');
    await expect(page.locator('.app-header')).toHaveCSS('height', '0px');
    const menuBox = await page.locator('#nav-toggle').boundingBox();
    const saveBox = await page.getByRole('button', { name: 'Save', exact: true }).boundingBox();
    expect(Math.abs(menuBox.y - saveBox.y)).toBeLessThan(8);
    expect(menuBox.height).toBeGreaterThanOrEqual(44);
    await page.locator('#nav-toggle').click();
    await expect(page.getByRole('link', { name: 'My looks', exact: true })).toBeVisible();
    await page.locator('#nav-toggle').click();
    await expect(page.getByRole('textbox', { name: 'Look title', exact: true })).toBeHidden();
    await page.locator('.phone-look-menu > summary').click();
    await page.getByRole('textbox', { name: 'Look title', exact: true }).fill('Phone performance renamed');
    await expect(page.getByRole('button', { name: 'History', exact: true })).toBeVisible();
    await page.locator('.phone-look-menu > summary').click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get(`${studio.origin}/api/looks/${look.id}`))
      .json()).look.title).toBe('Phone performance renamed');
    await shot('layers');
    await page.locator('.layer-name').first().click();
    await expect(page.locator('.phone-head')).toBeVisible();
    await expect(page.locator('.param-mod')).toHaveCount(0);
    await expect(page.locator('.chain-host')).toHaveCount(0);
    await page.locator('.phone-module-picker').click();
    await expect(page.getByRole('region', { name: 'Module chain' })).toBeVisible();
    const enabled = page.locator('.chain-on').first();
    await enabled.uncheck();
    await expect(enabled).not.toBeChecked();
    await enabled.check();
    await page.locator('[data-module=bars] .chain-name').click();
    await expect(page.locator('[data-module=bars] .chain-name')).toHaveAttribute('aria-current', 'true');
    await page.locator('.phone-module-picker').click();
    const bars = page.locator('[data-tour="param:bars"] input').first();
    await expect(bars).toBeHidden();
    await expect(page.locator('[data-tour="param:colours"]')).toBeVisible();
    await expect(page.locator('[data-tour="param:speed"]')).toBeHidden();
    await page.getByText('More settings', { exact: true }).click();
    await bars.fill('7');
    await bars.press('Enter');
    await page.getByText('More settings', { exact: true }).click();
    await expect(bars).toBeHidden();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get(`${studio.origin}/api/looks/${look.id}`))
      .json()).look.layers[0].modules.find((m) => m.id === 'bars').params.bars).toBe(7);
    await page.getByText('More settings', { exact: true }).click();
    await expect(bars).toHaveValue(/^7(?:\.0+)?$/);
    await page.getByText('More settings', { exact: true }).click();
    await page.locator('.phone-module-picker').click();
    await page.locator('[data-module=hue] .chain-name').click();
    await page.locator('.phone-module-picker').click();
    await expect(page.locator('[data-tour="param:offset"]')).toBeVisible();
    await expect(page.locator('[data-tour="param:speed"]')).toBeHidden();
    await page.getByText('More settings', { exact: true }).click();
    await expect(page.locator('[data-tour="param:speed"]')).toBeVisible();
    await page.getByText('More settings', { exact: true }).click();
    await page.locator('.phone-module-picker').click();
    await page.locator('[data-module=bars] .chain-name').click();
    await page.locator('.phone-module-picker').click();
    await expect(bars).toBeHidden();
    await expect(page.getByRole('button', { name: /^Solo / })).toBeHidden();
    await page.getByLabel('Layer menu', { exact: true }).click();
    const solo = page.getByRole('button', { name: /^Solo / });
    await solo.click();
    await expect(solo).toHaveAttribute('aria-pressed', 'true');
    await solo.click();
    await expect(page.getByRole('button', { name: 'Reset all to defaults', exact: true })).toBeVisible();
    await page.getByLabel('Layer menu', { exact: true }).click();
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
