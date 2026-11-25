// npm run smoke, too: Admin → People (spec/http "People") on a laptop and a phone: an account made a curator,
// disabled and enabled, then deleted after a confirm. Screenshots land in the test's output folder.
import { expect, test } from './studio.js';

test.use({ serverOptions: { admins: 'people-admin' } });

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const shot = (page, info, step) => page.screenshot({ path: info.outputPath(`${step}.png`), fullPage: true });

/** Signs `username` up through the API, so People has someone to list. */
const signup = (request, origin, username) => request.post(`${origin}/api/signup`,
  { data: { username, password: 'correct horse' } });

/** A page of `options`' size signed in as the admin, on People. */
async function people(browser, origin, options = {}) {
  const ctx = await browser.newContext(options), page = await ctx.newPage();
  const first = await signup(page.request, origin, 'people-admin');
  if (first.status() !== 201) {
    await page.request.post(`${origin}/api/login`, { data: { username: 'people-admin', password: 'correct horse' } });
  }
  await page.goto(`${origin}/admin/people`);
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
  return { ctx, page };
}

test('People changes a role, disables and deletes an account', async ({ browser, studio }, info) => {
  const { ctx, page } = await people(browser, studio.origin);
  const other = await browser.newContext();
  expect((await signup(other.request, studio.origin, 'moth')).status()).toBe(201);
  await other.close();
  await page.reload();
  const row = page.locator('.people-row', { hasText: 'moth' });
  await expect(page.locator('.people-row', { hasText: 'people-admin' }).getByLabel('Role')).toBeDisabled();
  await row.getByLabel('Role').selectOption('curator');
  await expect(row.getByLabel('Role')).toHaveValue('curator');
  await row.getByRole('button', { name: 'Disable' }).click();
  await expect(row.getByText('Disabled')).toBeVisible();
  await shot(page, info, '1-people-laptop');
  await row.getByRole('button', { name: 'Enable' }).click();
  await expect(row.getByText('Disabled')).toHaveCount(0);
  await row.getByRole('button', { name: 'Delete…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete account' });
  await expect(confirm).toContainText('Delete the account moth? This cannot be undone.');
  await confirm.getByRole('button', { name: 'Delete account' }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.people-row', { hasText: 'moth' })).toHaveCount(0);
  await ctx.close();
});

test('People on a phone', async ({ browser, studio }, info) => {
  const { ctx, page } = await people(browser, studio.origin, PHONE);
  await expect(page.getByLabel('Admin page')).toHaveValue('people');
  await shot(page, info, '2-people-phone');
  await ctx.close();
});
