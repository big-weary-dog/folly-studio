// npm run smoke, too: a look's description is edited in place in the Studio (under the title on a laptop, the Look
// tab on a phone), saves with the look, and shows on its gallery card. Screenshots land in DESCRIBE_SHOTS when set,
// else the test's output folder.
import path from 'node:path';

import { expect, test } from './studio.js';

const WORDS = 'Ember waves roll up the spires and settle into a slow red glow.';

for (const width of [390, 1366]) {
  test(`a look is described for the gallery at ${width}`, async ({ page, studio }, info) => {
    const shot = (name) => page.screenshot({ path: process.env.DESCRIBE_SHOTS
      ? path.join(process.env.DESCRIBE_SHOTS, `${width}-${name}.png`) : info.outputPath(`${name}.png`) });
    await page.setViewportSize({ width, height: width < 600 ? 844 : 768 });
    const post = (url, data) => page.context().request.post(studio.origin + url, { data });
    const username = `describe-${width}`;
    expect((await post('/api/signup', { username, password: 'correct horse' })).status()).toBe(201);
    const { look } = await (await post('/api/looks', { title: `Ember drift ${width}`, layers: [] })).json();
    expect((await page.context().request.put(`${studio.origin}/api/looks/${look.id}`, { data: { shared: true } }))
      .ok()).toBe(true);

    await page.goto(`${studio.origin}/studio/${look.id}`);
    let field;
    if (width < 600) {
      await page.locator('.tab[data-tab=look]').click();
      await page.getByText('Share details', { exact: true }).click();
      field = page.getByRole('textbox', { name: 'Description' });
    } else field = page.getByRole('textbox', { name: 'Look description' });
    await expect(field).toHaveAttribute('placeholder', 'Describe it for the gallery');
    await field.fill(WORDS);
    await field.blur();
    await shot('studio-describe');
    await page.locator('.save-btn').click();
    await expect(page.locator('.save-btn')).toBeEnabled();
    await expect.poll(async () => (await (await page.context().request.get(`${studio.origin}/api/looks/${look.id}`))
      .json()).look.summary).toBe(WORDS);

    await page.goto(`${studio.origin}/gallery`);
    await expect(page.locator('.card', { hasText: `Ember drift ${width}` }).locator('.card-summary')).toHaveText(WORDS);
    await shot('gallery-card');
  });
}
