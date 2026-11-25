// npm run smoke, too: the privacy page (spec/http "Privacy") from sign-in, signed out, and from the user menu,
// signed in, on a laptop and a phone. Screenshots land in the test's output folder.
import { SIZES } from './sizes.js';
import { expect, test } from './studio.js';

const shot = (page, info, step) => page.screenshot({ path: info.outputPath(`${step}.png`), fullPage: true });

for (const [size, options] of Object.entries(SIZES)) {
  test(`Privacy from sign-in and the user menu, ${size}`, async ({ browser, studio }, info) => {
    const page = await (await browser.newContext(options)).newPage();
    await page.goto(`${studio.origin}/login`);
    await page.getByRole('link', { name: /Privacy/ }).click();
    await expect(page).toHaveURL(`${studio.origin}/privacy`);
    await expect(page.getByText('each is deleted after 90 days')).toBeVisible();
    await shot(page, info, `1-signed-out-${size}`);
    await page.getByRole('link', { name: 'Back to sign in' }).click();
    await expect(page).toHaveURL(`${studio.origin}/login`);

    await page.getByRole('button', { name: 'Sign up' }).click();
    await page.fill('input[name=username]', `privacy-${size}`);
    await page.fill('input[name=password]', 'correct horse');
    await page.locator('form button[type=submit]').click();
    await expect(page.locator('#user-menu-btn')).toBeAttached();
    await page.getByRole('button', { name: 'Not now' }).click({ timeout: 3000 }).catch(() => {});
    if (options.isMobile) await page.locator('#nav-toggle').click();
    else await page.locator('#user-menu-btn').click();
    await page.getByRole('link', { name: 'Privacy' }).click();
    await expect(page).toHaveURL(`${studio.origin}/privacy`);
    await expect(page.getByRole('heading', { name: 'Deleting your data' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to sign in' })).toHaveCount(0);
    await shot(page, info, `2-signed-in-${size}`);
  });
}
