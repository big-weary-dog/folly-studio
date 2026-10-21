// npm run smoke, too: the model registry in a browser at a laptop's and a phone's size. An admin's Models panel turns
// a model off and saves; the idea form then offers what is left, and an idea goes to the model picked there (a
// stand-in codex CLI, test/fixtures/generate/bin/codex, which answers with a look at once; no Anthropic key).
import { fileURLToPath } from 'node:url';

import { expect, test } from './studio.js';

const BIN = fileURLToPath(new URL('../fixtures/generate/bin/', import.meta.url));
const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
test.use({ serverOptions: { admins: 'models-laptop,models-phone', models: { codexBin: `${BIN}codex`,
  env: { ...process.env, ANTHROPIC_API_KEY: '', PATH: `${BIN}:${process.env.PATH}` } } } });

for (const [name, device] of Object.entries(SIZES)) {
  test.describe(`${name}, ${device.viewport.width} × ${device.viewport.height}`, () => {
    test.use(device);

    test('an admin turns a model off; an idea goes to the model picked', async ({ page, studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const shot = (step) => page.screenshot({ path: info.outputPath(`${step}.png`), timeout: 60_000 });
      await page.goto(`${studio.origin}/login`);
      await page.getByRole('button', { name: 'Sign up' }).click();
      await page.fill('input[name=username]', `models-${name}`);
      await page.fill('input[name=password]', 'correct horse');
      await page.locator('form button[type=submit]').click();
      await expect(page.locator('textarea.idea-input')).toBeVisible({ timeout: 20_000 });

      const pick = page.locator('.model-pick select');
      const luna = page.locator('.model-row', { hasText: 'Luna' });
      const toggleLuna = async () => {
        await page.goto(`${studio.origin}/admin/models`);
        await luna.locator('input.switch').click();
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
      };

      await test.step('the Models panel turns Luna off, and the idea form stops offering it', async () => {
        await page.goto(`${studio.origin}/admin/models`);
        await expect(page.locator('.model-row', { hasText: 'Opus' })).toContainText('ANTHROPIC_API_KEY is not set');
        await expect(luna).toContainText('Codex CLI found');
        await expect(luna.locator('input.switch')).toBeChecked();
        await shot('models');
        await toggleLuna();
        await expect(page.getByText('Models saved.')).toBeVisible();
        await page.goto(`${studio.origin}/ideas`);
        await expect(pick.locator('option')).toHaveText(['Sol']);
        await expect(pick).toHaveValue('sol'); // the default cannot run here (no key): the first that can
      });

      await test.step('back on, Luna is picked, and the idea goes there', async () => {
        await toggleLuna(); // back on (the next size's run shares this server)
        await page.goto(`${studio.origin}/ideas`);
        await expect(pick.locator('option')).toHaveText(['Sol', 'Luna']);
        await pick.selectOption('luna');
        await page.fill('textarea.idea-input', 'A slow blue sky over the spires');
        await shot('idea-form');
        await page.getByRole('button', { name: 'Turn it into a look' }).click();
        await expect(page.getByRole('link', { name: 'Open in Studio' }).first()).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.idea').first()).toContainText(/by Luna in \d+ s/);
        await shot('idea-ready');
      });
      expect(errors).toEqual([]);
    });
  });
}
