// npm run smoke, too: an admin deletes someone's look from the gallery (SPEC-access "Who may do what"): its card's
// Delete asks, naming the look and its owner, and the card goes; the Studio's gallery notice has the same Delete.
// Screenshots land in GALLERY_SHOTS when set, else the test's output folder.
import path from 'node:path';

import { expect, test } from './studio.js';

test.use({ serverOptions: { admins: 'gallery-admin-390,gallery-admin-1366' } });

/** A signed-up account in `context`, sharing a look of its own for each title. */
async function account(context, origin, username, titles = []) {
  const post = (url, data) => context.request.post(origin + url, { data });
  expect((await post('/api/signup', { username, password: 'correct horse' })).status()).toBe(201);
  for (const title of titles) {
    const { look } = await (await post('/api/looks', { title, layers: [] })).json();
    expect((await context.request.put(`${origin}/api/looks/${look.id}`, { data: { shared: true } })).ok()).toBe(true);
  }
}

for (const width of [390, 1366]) {
  test(`an admin deletes a gallery look at ${width}`, async ({ browser, page, studio }, info) => {
    const shot = (name) => page.screenshot({ path: process.env.GALLERY_SHOTS
      ? path.join(process.env.GALLERY_SHOTS, `${width}-${name}.png`) : info.outputPath(`${name}.png`) });
    await page.setViewportSize({ width, height: width < 600 ? 844 : 768 });
    const owner = await browser.newContext();
    await account(owner, studio.origin, `gallery-owner-${width}`, ['Ember drift', 'Rose bloom']);
    await owner.close();
    await account(page.context(), studio.origin, `gallery-admin-${width}`);

    await page.goto(`${studio.origin}/gallery`);
    const card = page.locator('.card', { hasText: 'Ember drift' });
    await expect(card.getByRole('button', { name: 'Delete Ember drift' })).toBeVisible();
    await shot('card-delete');
    await card.getByRole('button', { name: 'Delete Ember drift' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`Delete “Ember drift” by gallery-owner-${width}? This cannot be undone.`);
    await shot('confirm');
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(card).toHaveCount(0);

    await page.locator('.card', { hasText: 'Rose bloom' }).getByRole('link', { name: 'Open' }).click();
    const notice = page.locator('.studio-notice');
    await expect(notice).toContainText('From the gallery');
    await shot('studio-delete');
    await notice.getByRole('button', { name: 'Delete Rose bloom' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page).toHaveURL(/\/gallery$/);
    await expect(page.locator('.card', { hasText: 'Rose bloom' })).toHaveCount(0);
  });
}
