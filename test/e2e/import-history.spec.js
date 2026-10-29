// The on-site Pi import accepts old library exports while Custom code is off.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { expect, test } from './studio.js';

test.use({ serverOptions: { profile: 'pi', customCode: false } });
test('import an earlier library Noise with custom code off', async ({ page, studio }, info) => {
  const code = execFileSync('git', ['show', '1cfdcda6:public/patterns/noise.js'], { encoding: 'utf8' });
  const current = readFileSync(new URL('../../public/patterns/noise.js', import.meta.url), 'utf8');
  const look = { title: 'Simple Noise Bed', origin: 'old-prod-noise', chain: 2, duration: 30,
    globals: { macros: { breath: { value: 0.5, min: 0, max: 1 } } },
    automation: { breath: [[0, 0], [10, 1]], archAccent: [[0, 1]] },
    layers: [{ id: 'l1', title: 'Noise', modules: [
      { id: 'm1', kind: 'source', ref: 'noise', title: 'Noise', code, params: { speed: 0.2 } },
    ] }] };
  await page.goto(`${studio.origin}/login`);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.fill('input[name=username]', 'import-crew');
  await page.fill('input[name=password]', 'correct horse');
  await page.locator('form button[type=submit]').click();
  await expect(page.locator('h1.page-title')).toHaveText('My looks');
  await page.locator('input[type=file]').setInputFiles({ name: 'old-noise.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(look)) });
  await expect(page.getByRole('dialog', { name: 'Import looks' })).toBeVisible();
  await page.getByRole('button', { name: 'Import looks', exact: true }).click();
  await expect(page.getByText('Imported: 1 added.')).toBeVisible();
  await expect(page.locator('.card', { hasText: 'Simple Noise Bed' })).toBeVisible();
  const list = await (await page.request.get(`${studio.origin}/api/looks`)).json();
  const saved = await (await page.request.get(`${studio.origin}/api/looks/${list.looks[0].id}`)).json();
  expect(saved.look.layers[0].modules[0].code).toBe(current);
  expect(saved.look.layers[0].modules[0].params).toEqual({ speed: 0.2 });
  expect(saved.look.automation).toEqual({ breath: look.automation.breath });
  await page.screenshot({ path: info.outputPath('imported-history.png') });
});
