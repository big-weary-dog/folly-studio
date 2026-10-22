// npm run smoke, too: a guest (SPEC-access "Guests") at a laptop's and a phone's size. In by a name alone, on to
// the Studio with no AI and no My looks; their edits are kept in the browser and back after a reload, the cookie
// letting them in; Save asks them to sign up, and the new account takes the work to save.
import { expect, test } from './studio.js';

const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

for (const [name, device] of Object.entries(SIZES)) {
  test.describe(`${name}, ${device.viewport.width} × ${device.viewport.height}`, () => {
    test.use(device);

    test('a guest makes a look, keeps it here, and signs up to save it', async ({ page, studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const shot = (step) => page.screenshot({ path: info.outputPath(`${step}.png`), timeout: 60_000 });
      const layers = page.locator('li.layer'), nav = page.locator('.main-nav'), { store } = studio.app;
      const accounts = store.users.list().length;

      await test.step('in by a name: the Studio, with no AI and no My looks', async () => {
        await page.goto(`${studio.origin}/login`);
        await page.getByRole('button', { name: 'Guest', exact: true }).click();
        await page.getByLabel('Your name').fill('Wren');
        await shot('guest-login');
        await page.getByRole('button', { name: 'Come in as a guest' }).click();
        await expect(page).toHaveURL(`${studio.origin}/studio`);
        await expect(layers).toHaveCount(1, { timeout: 60_000 });
        await expect(page.locator('.user-box .tag')).toHaveText('Guest');
        await expect(nav.locator('a[href="/ideas"]')).toHaveCount(0);
        await expect(nav.locator('a[href="/looks"]')).toHaveCount(0);
        expect(store.users.list()).toHaveLength(accounts);
      });

      await test.step('an edit is kept in this browser, and back after a reload', async () => {
        await page.getByRole('button', { name: 'Duplicate layer' }).click();
        await expect(layers).toHaveCount(2);
        await expect.poll(() => page.evaluate(() => localStorage.getItem('folly-guest-work'))).toContain('"layers"');
        await shot('guest-studio');
        await page.reload();
        await expect(page).toHaveURL(`${studio.origin}/studio`);
        await expect(layers).toHaveCount(2, { timeout: 60_000 });
      });

      await test.step('Save asks them to sign up; the account takes the work and saves it', async () => {
        await page.keyboard.press('Control+s');
        const ask = page.getByRole('dialog', { name: 'Log in to save' });
        await expect(ask).toBeVisible();
        await shot('guest-save');
        await ask.getByRole('button', { name: 'Log in or sign up' }).click();
        await expect(page).toHaveURL(`${studio.origin}/login?mode=signup&next=/studio`);
        await page.fill('input[name=username]', `kept-${name}`);
        await page.fill('input[name=password]', 'correct horse');
        await page.locator('form button[type=submit]').click();
        await expect(page).toHaveURL(`${studio.origin}/studio`);
        await expect(layers).toHaveCount(2, { timeout: 60_000 });
        await page.keyboard.press('Control+s');
        await expect(page.locator('.toast-msg').last()).toHaveText('Saved.');
        const me = store.users.list((u) => u.username === `kept-${name}`)[0];
        expect(store.looks.list((l) => l.owner === me.id).map((l) => l.layers.length)).toEqual([2]);
      });
      expect(errors).toEqual([]);
    });
  });
}
