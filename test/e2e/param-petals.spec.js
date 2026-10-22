// npm run smoke: text params with `petals` and `cells` (petal-mask's Petals and Cells shown) are a rose and a petal to
// click, side by side, at a laptop's and a phone's size: a click flips one and rewrites the text; typed text relights.
import { readFileSync } from 'node:fs';

import { expect, signup, test } from './studio.js';

const code = (name) => readFileSync(new URL(`../../public/patterns/${name}.js`, import.meta.url), 'utf8');
const look = { title: 'Picked petals', duration: 16, layers: [{ title: 'Rose', groups: ['rose-window'], modules: [
  { id: 'm1', kind: 'source', ref: 'bars', code: code('bars'), params: { direction: 'clockwise', bars: 4 } },
  { id: 'm2', kind: 'filter', ref: 'petal-mask', code: code('petal-mask'),
    params: { petals: '1-3 7 9-11 15', cells: '1-4 7-9 12-14' } },
] }] };

const DEVICES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

for (const [name, device] of Object.entries(DEVICES)) {
  test.describe(`${name}`, () => {
    test.use(device);
    test('petal-mask\'s Petals and Cells shown are a rose and a petal to click', async ({ page, studio }, info) => {
      const cookie = await signup(studio.origin, `petals-${name}`);
      const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST', body: JSON.stringify(look),
        headers: { 'content-type': 'application/json', cookie } });
      expect(res.status).toBe(201);
      const { look: { id } } = await res.json();
      const [key, value] = cookie.split('=');
      await page.context().addCookies([{ name: key, value, url: studio.origin }]);
      await page.goto(`${studio.origin}/studio/${id}`);
      const pick = page.locator('.view-select:visible, .view-btn[data-view=rose]:visible').first();
      if (name === 'phone') await pick.selectOption('rose', { timeout: 30_000 });
      else await pick.click({ timeout: 30_000 });
      if (name === 'phone') await page.locator('.layer-name:visible').first().click({ timeout: 30_000 });
      await page.locator('.chain-name:visible', { hasText: /petal mask/i }).click({ timeout: 30_000 });
      const field = page.locator('.field.param', { hasText: 'Petals shown' });
      const text = field.locator('input.param-text'), petal = (n) => field.getByRole('checkbox', { name: `Petal ${n}`,
        exact: true });
      await expect(text).toHaveValue('1-3 7 9-11 15');
      await expect(petal(7)).toHaveAttribute('aria-checked', 'true');
      await expect(petal(8)).toHaveAttribute('aria-checked', 'false');
      const cells = page.locator('.field.param', { hasText: 'Cells shown' }), cell = (n) => cells.getByRole('checkbox',
        { name: `Cell ${n}`, exact: true });
      await expect(page.locator('.rose-pickers .field.param')).toHaveCount(2);
      await expect(cell(12)).toHaveAttribute('aria-checked', 'true');
      await expect(cell(5)).toHaveAttribute('aria-checked', 'false');
      await page.waitForTimeout(1500);              // the preview draws a few frames
      await page.screenshot({ path: info.outputPath(`${name}.png`) });
      await field.scrollIntoViewIfNeeded();
      await page.locator('.rose-pickers').screenshot({ path: info.outputPath(`${name}-field.png`) });
      await cell(5).click();
      await expect(cells.locator('input.param-text')).toHaveValue('1-5 7-9 12-14');
      await cell(1).press(' ');
      await expect(cells.locator('input.param-text')).toHaveValue('2-5 7-9 12-14');

      await petal(8).click();
      await expect(text).toHaveValue('1-3 7-11 15');
      await petal(2).press('Enter');
      await expect(text).toHaveValue('1 3 7-11 15');
      await petal(2).press(' ');
      await expect(text).toHaveValue('1-3 7-11 15');
      await petal(2).press(' ');
      await text.fill('16-2, 5');
      await text.blur();
      await expect(petal(16)).toHaveAttribute('aria-checked', 'true');
      await expect(petal(5)).toHaveAttribute('aria-checked', 'true');
      await expect(petal(7)).toHaveAttribute('aria-checked', 'false');
      await page.screenshot({ path: info.outputPath(`${name}-typed.png`) });
    });
  });
}
