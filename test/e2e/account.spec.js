// npm run smoke, too: the Account page (spec/http "Your account"), from the user menu on a laptop and a phone: a new
// password, then the account deleted with its looks, back on sign-in. Screenshots land in the test's output folder.
import { expect, test } from './studio.js';

const LAPTOP = { viewport: { width: 1366, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const shot = (page, info, step) => page.screenshot({ path: info.outputPath(`${step}.png`), fullPage: true });

/** Signs `name` up on a fresh page of `options`' size, with two looks, one shared; opens Account from the menu. */
async function account(browser, origin, name, options) {
  const ctx = await browser.newContext(options), page = await ctx.newPage();
  await page.goto(`${origin}/login?mode=signup`);
  await page.fill('input[name=username]', name);
  await page.fill('input[name=password]', 'correct horse');
  await page.locator('form button[type=submit]').click();
  await expect(page.locator('#user-menu-btn')).toBeAttached();
  await page.getByRole('button', { name: 'Not now' }).click({ timeout: 3000 }).catch(() => {});
  for (const [title, shared] of [['Mine', false], ['Ours', true]]) {
    const r = await page.request.post(`${origin}/api/looks`, { data: { title, shared, layers: [] } });
    expect(r.status()).toBe(201);
  }
  if (options.isMobile) await page.locator('#nav-toggle').click();
  else await page.locator('#user-menu-btn').click();
  await page.getByRole('link', { name: 'Account' }).click();
  await expect(page).toHaveURL(`${origin}/account`);
  await expect(page.getByText('2 looks, 1 shared')).toBeVisible();
  return { ctx, page };
}

test('Account changes the password, and deletes the account after a confirm', async ({ browser, studio }, info) => {
  const { ctx, page } = await account(browser, studio.origin, 'acct-laptop', LAPTOP);
  await shot(page, info, '1-account-laptop');
  const pass = page.locator('form', { has: page.getByRole('heading', { name: 'Change password' }) });
  await pass.getByLabel('Current password').fill('wrong one');
  await pass.getByLabel('New password').fill('battery staple');
  await pass.getByRole('button', { name: 'Change password' }).click();
  await expect(pass.getByRole('alert')).toHaveText('That is not your password.');
  await pass.getByLabel('Current password').fill('correct horse');
  await pass.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed.')).toBeVisible();

  const del = page.locator('form', { has: page.getByRole('heading', { name: 'Delete account' }) });
  await del.getByLabel('Your password').fill('battery staple');
  await del.getByRole('button', { name: 'Delete account…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete account' });
  await expect(confirm).toContainText('Delete the account acct-laptop and its 2 looks (1 shared in the gallery)?');
  await shot(page, info, '2-confirm-laptop');
  await confirm.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText('a forgotten password cannot be reset')).toBeVisible();
  await shot(page, info, '3-signup-laptop');
  await ctx.close();
});

test('Account on a phone', async ({ browser, studio }, info) => {
  const { ctx, page } = await account(browser, studio.origin, 'acct-phone', PHONE);
  await shot(page, info, '4-account-phone');
  await ctx.close();
});
