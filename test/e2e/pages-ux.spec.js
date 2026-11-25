// Audit regressions: drafts, reporting eligibility and tutorial availability.
import { expect, signup, test } from './studio.js';

test.use({ serverOptions: { admins: 'pages-admin-1366,pages-admin-390,pages-admin-360' } });

for (const width of [1366, 390, 360]) {
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: width < 900 ? 844 : 900 } });
    const shot = (page, name) => page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`),
      fullPage: true });
    const menu = async (page) => {
      await page.locator(width < 900 ? '#nav-toggle' : '#user-menu-btn').click();
    };

    test('a draft survives cancelled navigation', async ({ page, studio }) => {
      const cookie = await signup(studio.origin, `pages-admin-${width}`);
      const [name, value] = cookie.split('=');
      await page.context().addCookies([{ name, value, url: studio.origin }]);
      await page.goto(`${studio.origin}/admin`);
      await expect(page).toHaveURL(/\/admin\/light$/);
      if (width < 900) {
        await page.getByRole('combobox', { name: 'Admin page' }).selectOption('reports');
        await expect(page.getByRole('button', { name: 'Report a problem', exact: true })).toBeVisible();
        await expect(page.locator('.report-list')).toHaveCount(0);
        return;
      }
      const gamma = page.getByRole('spinbutton', { name: 'Output gamma' });
      await gamma.fill('1.5');
      await gamma.press('Enter');
      await expect(page.getByRole('button', { name: 'Download light.json' })).toBeDisabled();
      await shot(page, 'light-draft');
      await page.locator('.admin-tabs a[data-tab=baking]').click();
      const leave = page.getByRole('dialog', { name: 'Unsaved changes' });
      await expect(leave).toBeVisible();
      await leave.getByRole('button', { name: 'Cancel' }).click();
      await expect(gamma).toHaveValue(/^1\.50/);
      await page.getByRole('button', { name: 'Revert', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Download light.json' })).toBeEnabled();
    });

    test('guests and signed-out visitors cannot enter an unsendable report',
      async ({ page, studio }) => {
        await page.goto(`${studio.origin}/login?mode=signup`);
        await shot(page, 'signup');
        await page.keyboard.press('F8');
        await expect(page.getByRole('dialog', { name: 'Report a problem' })).toHaveCount(0);
        await expect(page.getByText(/Reporting a problem needs an account/).last()).toBeVisible();
        await shot(page, 'report-signedout');
        await page.getByText(/Reporting a problem needs an account/).hover();
        await page.fill('input[name=username]', `pages-member-${width}`);
        await page.fill('input[name=password]', 'correct horse');
        await page.locator('input[name=password]').press('Enter');
        await expect(page).toHaveURL(/\/gallery$/);
        await expect(page.getByText(/Reporting a problem needs an account/)).toHaveCount(0);
        await shot(page, 'looks');
        await page.keyboard.press('F8');
        const report = page.getByRole('dialog', { name: 'Report a problem' });
        await expect(report).toBeVisible();
        await report.getByLabel('What went wrong?').fill('An account can report.');
        await shot(page, 'report-account');
        const sent = page.waitForResponse((r) => r.url().endsWith('/api/reports') && r.request().method() === 'POST');
        await report.getByRole('button', { name: 'Send', exact: true }).click();
        expect((await sent).status()).toBe(201);
        await expect(report).toContainText('Sent. Thanks!');
        await expect(report).toBeHidden();
        await menu(page);
        const tutorials = page.getByRole('button', { name: 'Tutorials', exact: true });
        if (width < 900) await expect(tutorials).toBeHidden();
        else await expect(tutorials).toBeVisible();
        const logOut = page.getByRole('button', { name: 'Log out', exact: true });
        for (const button of ['Report a problem', 'Log out']) {
          const box = await page.getByRole('button', { name: button, exact: true }).boundingBox();
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
        await shot(page, 'account-menu');
        await logOut.click();
        await page.getByRole('button', { name: 'Try it', exact: true }).click();
        await expect(page).toHaveURL(/\/gallery$/);
        await page.keyboard.press('F8');
        await expect(page.getByRole('dialog', { name: 'Report a problem' })).toHaveCount(0);
        await expect(page.getByText(/Reporting a problem needs an account/).last()).toBeVisible();
        await shot(page, 'report-guest');
        if (width === 1366) {
          await menu(page);
          await tutorials.click();
          await page.getByRole('button', { name: /^Keep it/ }).click();
          const card = page.locator('.tour-step');
          await card.getByRole('button', { name: /^(Skip step|Next)$/, disabled: false }).click();
          await card.getByRole('button', { name: /^(Skip step|Next)$/, disabled: false }).click();
          await expect(card).toContainText('Your work stays in this browser');
          await expect(card.getByRole('button', { name: 'Finish', exact: true })).toBeEnabled();
          await shot(page, 'guest-keep');
        }
      });
  });
}
