// Vampire ball catalogue choices reach the saved look and its running preview.
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, signup, test } from './studio.js';

test.use({ viewport: { width: 1366, height: 768 } });

test('vampire palettes: swatches, selection and preview', async ({ page, studio }, info) => {
  const cookie = await signup(studio.origin, 'vampire-palettes'), [name, value] = cookie.split('=');
  await page.context().addCookies([{ name, value, url: studio.origin }]);
  const catalogue = await (await page.request.get(`${studio.origin}/data/palettes.json`)).json();
  const code = await readFile(new URL('../../public/patterns/colour-wash.js', import.meta.url), 'utf8');
  const response = await page.request.post(`${studio.origin}/api/looks`, { data: {
    title: 'Vampire ball', chain: 2, duration: 30,
    layers: [{ id: 'l1', title: 'Vampire wash', modules: [
      { id: 'm1', kind: 'source', code, ref: 'colour-wash', params: { colours: 'all' } },
    ] }], globals: { palette: 'blood' },
  } });
  expect(response.ok()).toBe(true);
  const { look } = await response.json();
  await page.goto(`${studio.origin}/studio/${look.id}`);
  await page.locator('.dock-tab[data-dock=look]').click();
  const panel = page.locator('.globals-palette');
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const dir = process.env.PALETTE_SHOTS || info.outputPath('palettes');
  await mkdir(dir, { recursive: true });
  for (const palette of ['blood', 'crimson', 'amethyst', 'requiem']) {
    await panel.getByLabel('Palette', { exact: true }).selectOption(palette);
    const expected = catalogue.palettes.find((p) => p.name === palette);
    await expect(panel.locator('.swatch')).toHaveCount(9);
    await expect(panel.locator('.swatch').first()).toHaveAttribute('title', `low1 · ${expected.low[0]}`);
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-state')).toHaveText('Saved');
    const saved = await (await page.request.get(`${studio.origin}/api/looks/${look.id}`)).json();
    expect(saved.look.globals.palette.body).toEqual(expected.body);
    await expect(page.locator('canvas:visible').first()).toBeVisible();
    await page.waitForTimeout(1500); // let the changed palette reach the sandbox and preview
    await panel.screenshot({ path: path.join(dir, `${palette}-swatches.png`) });
    await page.screenshot({ path: path.join(dir, `${palette}-preview.png`) });
  }
  expect(errors).toEqual([]);
});
