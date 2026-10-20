// npm run smoke, too: how much an idea explores (SPEC-generators "Explore"), at a laptop's and a phone's size. The idea
// form offers Quick and Explore for a model that explores (Deep while DEEP.enabled), starts on Explore, keeps a pick
// per browser and hides them for Sketch; an idea sent at Explore says so and what it took from each sketch (a
// stand-in codex CLI, test/fixtures/generate/bin/codex, answers the sketch turn and the look at once).
import { fileURLToPath } from 'node:url';

import { expect, test } from './studio.js';

const BIN = fileURLToPath(new URL('../fixtures/generate/bin/', import.meta.url));
const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
test.use({ serverOptions: { admins: 'explore-laptop,explore-phone', models: { codexBin: `${BIN}codex`,
  env: { ...process.env, ANTHROPIC_API_KEY: '', PATH: `${BIN}:${process.env.PATH}` } } } });

for (const [name, device] of Object.entries(SIZES)) {
  test.describe(`${name}, ${device.viewport.width} × ${device.viewport.height}`, () => {
    test.use(device);

    test('Quick or Explore: picked, kept, and said on the idea', async ({ page, studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const shot = (step) => page.screenshot({ path: info.outputPath(`${step}.png`), timeout: 60_000 });
      await page.goto(`${studio.origin}/login`);
      await page.getByRole('button', { name: 'Sign up' }).click();
      await page.fill('input[name=username]', `explore-${name}`);
      await page.fill('input[name=password]', 'correct horse');
      await page.locator('form button[type=submit]').click();
      await expect(page.locator('textarea.idea-input')).toBeVisible({ timeout: 20_000 });

      const levels = page.locator('.explore .seg-btn'), hint = page.locator('.explore-hint');
      const pressed = page.locator('.explore .seg-btn[aria-pressed=true]');
      await test.step('Explore to start, Deep off; a pick is kept', async () => {
        await expect(levels).toHaveText(['Quick~1 min', 'Explore~5 min']);
        await expect(pressed).toHaveText(/^Explore/);
        await expect(hint).toContainText('Sketches 3 different takes');
        await page.fill('textarea.idea-input', 'The rose window blooms like a sunrise');
        await shot('explore');
        await levels.filter({ hasText: 'Quick' }).click();
        await expect(hint).toContainText('One composition');
        await page.reload();
        await expect(pressed).toHaveText(/^Quick/);
      });

      await test.step('Sketch does not explore; an idea at Explore says what it took', async () => {
        await page.locator('.model-pick select').selectOption('sketch');
        await expect(page.locator('.explore')).toHaveCount(0);
        await page.locator('.model-pick select').selectOption('sol');
        await levels.filter({ hasText: 'Explore' }).click();
        await page.fill('textarea.idea-input', 'A slow blue sky over the spires');
        await page.getByRole('button', { name: 'Turn it into a look' }).click();
        await expect(page.getByRole('link', { name: 'Open in Studio' }).first()).toBeVisible({ timeout: 60_000 });
        const row = page.locator('.idea').first();
        await expect(row).toContainText('Explore');
        await expect(row.locator('.idea-took')).toHaveText('Took the drift from Tide, the blue from Haze');
        await row.scrollIntoViewIfNeeded();
        await shot('idea-ready');
      });
      expect(errors).toEqual([]);
    });
  });
}
