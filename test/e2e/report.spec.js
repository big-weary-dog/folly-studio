// npm run smoke, too: F8 bug reports (SPEC "Bug reports"). F8 in the Studio freezes the preview under the form and
// files a report; Cancel thaws it; a phone files one from the menu; an admin finds them on the Reports page, and
// "Open as captured" opens the draft paused at the captured time. Screenshots land in the test's output folder.
import { expect, test } from './studio.js';

test.use({ serverOptions: { admins: 'olive' } });

const signIn = async (page, origin, name) => {
  await page.goto(`${origin}/login`);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.fill('input[name=username]', name);
  await page.fill('input[name=password]', 'correct horse');
  await page.locator('form button[type=submit]').click();
  await expect(page).toHaveURL(/\/ideas/);
};
const time = (page) => page.locator('.tp-scrub').inputValue().then(Number);
const shot = (page, info, step) => page.screenshot({ path: info.outputPath(`${step}.png`), timeout: 60_000 });

test('F8 freezes the Studio under the form and files a report; an admin replays it', async ({ browser, studio },
  info) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } }), page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await signIn(page, studio.origin, 'olive');
  await page.goto(`${studio.origin}/studio`);
  await expect(page.locator('.layer-list')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => time(page), { timeout: 30_000 }).toBeGreaterThan(0.5);

  await page.locator('#user-menu-btn').click();
  await expect(page.locator('#user-menu')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Report a problem' })).toBeInViewport();
  await shot(page, info, '0-user-menu-desktop');
  await page.keyboard.press('Escape');
  await expect(page.locator('#user-menu')).toBeHidden();

  await page.keyboard.press('F8');
  const dialog = page.getByRole('dialog', { name: 'Report a problem' });
  await expect(dialog).toBeVisible();
  const at = await time(page);
  await page.waitForTimeout(600);
  expect(await time(page), 'the preview is frozen').toBe(at);
  await expect(dialog.locator('.report-thumb')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => time(page), { message: 'it plays again' }).toBeGreaterThan(at);

  await page.keyboard.press('F8');
  await expect(dialog).toBeVisible();
  const frozenAt = await time(page);
  await dialog.locator('textarea').fill('The spires flicker');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('after a second');
  await shot(page, info, '1-f8-form-desktop');
  await page.keyboard.press('Enter');
  await expect(dialog.locator('.report-status')).toHaveText(/Sent/);
  await expect(dialog).toBeHidden();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mob = await phone.newPage();
  await signIn(mob, studio.origin, 'mona');
  await mob.goto(`${studio.origin}/studio`);
  await expect.poll(() => time(mob), { timeout: 30_000 }).toBeGreaterThan(0.3);
  await mob.locator('#nav-toggle').click();
  await shot(mob, info, '0-user-menu-phone');
  await mob.getByRole('button', { name: 'Report a problem' }).click();
  const form = mob.getByRole('dialog', { name: 'Report a problem' });
  await expect(form).toBeVisible();
  await form.locator('textarea').fill('Hard to tap the layers');
  await shot(mob, info, '2-report-phone');
  await form.getByRole('button', { name: 'Send' }).click();
  await expect(form).toBeHidden();
  await phone.close();

  await page.getByRole('link', { name: 'Admin', exact: true }).click();
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/\/admin\/reports$/);
  const rows = page.locator('.report-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('mona');
  await expect(rows.nth(1)).toContainText('The spires flicker');
  await shot(page, info, '3-reports-list');
  await rows.nth(1).locator('.report-head').click();
  await expect(rows.nth(1).locator('.report-detail-shot')).toBeVisible();
  await shot(page, info, '4-report-open');
  await rows.nth(1).getByRole('link', { name: /Open as captured/ }).click();
  await expect(page).toHaveURL(/\/studio\?report=/);
  await expect.poll(() => time(page), { timeout: 30_000 }).toBeCloseTo(frozenAt, 1);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, info, '5-open-as-captured');
  expect(errors).toEqual([]);
  await ctx.close();
});
