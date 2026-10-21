// npm run smoke, too: the Pi profile's Studio (SPEC-offline) at a laptop's and a phone's size. Signing up lands on
// My looks, with no Ideas tab and a Lights link for a curator; /ideas goes to My looks; Import takes a file of looks
// and Export all gives them back. Screenshots of each in the output, and no errors on the page.
import { readFile } from 'node:fs/promises';

import { expect, test } from './studio.js';

const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const PIXEL = 'function pixel(p, t, P) { return [p.x, p.y, p.z]; }';
const look = (title) => ({ title, summary: `${title}, from a file`, chain: 2, duration: 30,
  layers: [{ id: 'l1', title, code: PIXEL, groups: ['cathedral'], blend: 'add', params: {} }] });
test.use({ serverOptions: { profile: 'pi', curators: 'crew-laptop,crew-phone' } });

for (const [name, device] of Object.entries(SIZES)) {
  test.describe(`${name}, ${device.viewport.width} × ${device.viewport.height}`, () => {
    test.use(device);

    test('no ideas; a curator’s Lights link; import and export all', async ({ page, studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const shot = (step) => page.screenshot({ path: info.outputPath(`${step}.png`), timeout: 60_000 });
      const nav = page.locator('header');

      await test.step('signing up lands on My looks, with no Ideas and a Lights link', async () => {
        await page.goto(`${studio.origin}/login`);
        await page.getByRole('button', { name: 'Sign up' }).click();
        await page.fill('input[name=username]', `crew-${name}`);
        await page.fill('input[name=password]', 'correct horse');
        await page.locator('form button[type=submit]').click();
        await expect(page.locator('h1.page-title')).toHaveText('My looks', { timeout: 20_000 });
        await expect(nav.getByRole('link', { name: 'Ideas' })).toHaveCount(0);
        await expect(page.locator('a[href="/pi/"]')).toHaveCount(1);
        await expect(page.locator('main')).toContainText('or import some');
        await shot('empty');
        await page.goto(`${studio.origin}/ideas`);
        await expect(page).toHaveURL(/\/looks$/);
      });

      await test.step('Import takes a file of looks; a refused one is named', async () => {
        const bad = { ...look('Broken'), layers: 'nope' };
        await page.locator('input[type=file]').setInputFiles({ name: 'crew.json', mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify({ looks: [look('Embers'), look('Tide'), bad] })) });
        await expect(page.locator('.card')).toHaveCount(2);
        await expect(page.getByText('Imported 2 looks.')).toBeVisible();
        await expect(page.getByText(/Not imported: Broken/)).toBeVisible();
        await shot('imported');
      });

      await test.step('Export all gives the looks back as one file', async () => {
        const [file] = await Promise.all([page.waitForEvent('download'),
          page.getByRole('button', { name: 'Export all' }).click()]);
        expect(file.suggestedFilename()).toMatch(/^folly-looks-mine-\d{4}-\d\d-\d\d\.json$/);
        const { looks } = JSON.parse(await readFile(await file.path(), 'utf8'));
        expect(looks.map((l) => l.title).sort()).toEqual(['Embers', 'Tide']);
        expect(looks.every((l) => l.chain === 2)).toBe(true);
      });
      expect(errors).toEqual([]);
    });
  });
}
