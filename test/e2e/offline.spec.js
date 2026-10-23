// npm run smoke, too: the Pi profile's Studio (SPEC-offline) at a laptop's and a phone's size. Signing up lands on
// My looks, with no Ideas tab and a Lights link for a curator; /ideas goes to My looks; Import takes a file of looks
// and Export all gives them back (again: unchanged). Screenshots of each in the output, and no errors on the page.
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

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
        await page.locator('input[type=file]').setInputFiles([
          { name: 'older.json', mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({ ...look('Old embers'), origin: 'batchLook01' })) },
          { name: 'crew.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ looks: [
            { ...look('Embers'), origin: 'batchLook01' }, look('Tide'), bad] })) },
        ]);
        const shots = path.join(process.env.HOME, '.fleet/folly-studio/reports/ux-pages');
        await mkdir(shots, { recursive: true });
        await expect(page.getByRole('dialog', { name: 'Import looks' })).toBeVisible();
        await expect(page.getByRole('dialog')).toContainText('Old embers: add new look');
        await expect(page.getByRole('dialog')).toContainText('Embers: replace earlier import');
        for (const label of ['Cancel', 'Import as copies', 'Import looks']) {
          await expect(page.getByRole('dialog').getByRole('button', { name: label, exact: true })).toBeInViewport();
        }
        await page.screenshot({ path: path.join(shots, `import-preview-${device.viewport.width}.png`) });
        await page.getByRole('button', { name: 'Import looks', exact: true }).click();
        await expect(page.locator('.card')).toHaveCount(2);
        await expect(page.getByText('Imported: 2 added, 1 updated.')).toBeVisible();
        await expect(page.getByText(/Not imported: Broken/)).toBeVisible();
        await shot('imported');
      });

      await test.step('Export all gives the looks back as one file, which imports again unchanged', async () => {
        const [file] = await Promise.all([page.waitForEvent('download'),
          page.getByRole('button', { name: 'Export all' }).click()]);
        expect(file.suggestedFilename()).toMatch(/^folly-looks-mine-\d{4}-\d\d-\d\d\.json$/);
        const { looks } = JSON.parse(await readFile(await file.path(), 'utf8'));
        expect(looks.map((l) => l.title).sort()).toEqual(['Embers', 'Tide']);
        expect(looks.every((l) => l.chain === 2 && l.origin)).toBe(true);
        await page.locator('input[type=file]').setInputFiles(await file.path());
        await expect(page.getByRole('dialog')).toContainText('replace existing look');
        await page.screenshot({ path: path.join(process.env.HOME, '.fleet/folly-studio/reports/ux-pages',
          `import-replacements-${device.viewport.width}.png`) });
        await page.getByRole('button', { name: 'Import looks', exact: true }).click();
        await expect(page.getByText('Imported: 2 unchanged.')).toBeVisible();
        await expect(page.locator('.card')).toHaveCount(2);
        await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
        await page.locator('input[type=file]').setInputFiles(await file.path());
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.locator('.card')).toHaveCount(2);
        await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
        await page.locator('input[type=file]').setInputFiles(await file.path());
        await page.getByRole('button', { name: 'Import as copies', exact: true }).click();
        await expect(page.locator('.card')).toHaveCount(4);
      });
      expect(errors).toEqual([]);
    });
  });
}
