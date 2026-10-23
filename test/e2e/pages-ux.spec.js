// Audit regressions: drafts, inherited limits, invitation entry, reporting eligibility and tutorial availability.
import { expect, signup, test } from './studio.js';

test.use({ serverOptions: { admins: 'pages-admin-1366,pages-admin-390' } });

for (const width of [1366, 390]) {
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });
    const shot = (page, name) => page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`),
      fullPage: true });
    const menu = async (page) => {
      await page.locator(width === 390 ? '#nav-toggle' : '#user-menu-btn').click();
    };

    test('drafts survive cancelled navigation and Defaults clears a saved override', async ({ page, studio }) => {
      const cookie = await signup(studio.origin, `pages-admin-${width}`);
      const [name, value] = cookie.split('=');
      await page.context().addCookies([{ name, value, url: studio.origin }]);
      const member = `pages-member-${width}`;
      await signup(studio.origin, member);
      await page.goto(`${studio.origin}/admin/models`);
      const toggle = page.locator('.model-row input.switch').last();
      const original = await toggle.isChecked();
      await toggle.click();
      await page.locator('.admin-tabs a[data-tab=access]').click();
      const leave = page.getByRole('dialog', { name: 'Unsaved changes' });
      await expect(leave).toBeVisible();
      await shot(page, 'models-unsaved');
      await leave.getByRole('button', { name: 'Cancel' }).click();
      expect(await toggle.isChecked()).toBe(!original);
      await page.locator('.admin-tabs a[data-tab=access]').click();
      await leave.getByRole('button', { name: 'Leave', exact: true }).click();
      const person = page.locator('.access-row').filter({ has: page.getByText(member, { exact: true }) });
      await person.getByRole('button', { name: 'Limits', exact: true }).click();
      const hour = person.locator('input[type=number]').first();
      await hour.fill('1');
      await person.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(person).toContainText('own limits');
      await person.getByRole('button', { name: 'Defaults', exact: true }).click();
      await expect(hour).toHaveValue('');
      await expect(person).not.toContainText('own limits');
      await hour.fill('2');
      await person.getByRole('button', { name: 'Defaults', exact: true }).click();
      await expect(hour).toHaveValue('');
      await shot(page, 'access-defaults');
      await page.locator('.admin-tabs a[data-tab=light]').click();
      const gamma = page.getByRole('spinbutton', { name: 'Output gamma' });
      await gamma.fill('1.5');
      await gamma.press('Enter');
      await expect(page.getByRole('button', { name: 'Download for the Pi' })).toBeDisabled();
      await shot(page, 'light-draft');
      await page.locator('.admin-tabs a[data-tab=models]').click();
      await expect(leave).toBeVisible();
      await leave.getByRole('button', { name: 'Cancel' }).click();
      await expect(gamma).toHaveValue(/^1\.50/);
      await page.getByRole('button', { name: 'Revert', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Download for the Pi' })).toBeEnabled();
    });

    test('accounts learn about invites; guests and signed-out visitors cannot enter an unsendable report',
      async ({ page, studio }) => {
        await page.goto(`${studio.origin}/login?mode=signup`);
        await expect(page.getByText(/needs an invite code/)).toBeVisible();
        await shot(page, 'signup');
        await page.keyboard.press('F8');
        await expect(page.getByRole('dialog', { name: 'Report a problem' })).toHaveCount(0);
        await expect(page.getByText(/Reporting a problem needs an account/).last()).toBeVisible();
        await shot(page, 'report-signedout');
        await page.fill('input[name=username]', `pages-locked-${width}`);
        await page.fill('input[name=password]', 'correct horse');
        await page.locator('form button[type=submit]').click();
        await expect(page.getByRole('button', { name: 'Enter invite code' })).toBeVisible();
        await shot(page, 'locked-looks');
        await page.getByRole('button', { name: 'Enter invite code' }).click();
        await expect(page.getByRole('dialog', { name: 'Invite code' })).toBeVisible();
        await page.keyboard.press('Escape');
        await menu(page);
        const tutorials = page.getByRole('button', { name: 'Tutorials', exact: true });
        if (width === 390) await expect(tutorials).toBeHidden();
        else await expect(tutorials).toBeVisible();
        await shot(page, 'account-menu');
        await page.getByRole('button', { name: 'Log out', exact: true }).click();
        await page.getByRole('button', { name: 'Guest', exact: true }).click();
        await page.getByLabel('Your name').fill('Visitor');
        await page.getByRole('button', { name: 'Come in as a guest' }).click();
        await expect(page).toHaveURL(/\/studio$/);
        await page.keyboard.press('F8');
        await expect(page.getByRole('dialog', { name: 'Report a problem' })).toHaveCount(0);
        await expect(page.getByText(/Reporting a problem needs an account/).last()).toBeVisible();
        await shot(page, 'report-guest');
        if (width === 1366) {
          await menu(page);
          await tutorials.click();
          await page.getByRole('button', { name: /Keep it, show it/ }).click();
          const card = page.locator('.tour-step');
          await card.getByRole('button', { name: /^(Skip step|Next)$/, disabled: false }).click();
          await card.getByRole('button', { name: /^(Skip step|Next)$/, disabled: false }).click();
          await expect(card).toContainText('Your work stays in this browser');
          await expect(card.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
          await shot(page, 'guest-keep');
          await card.getByRole('button', { name: 'Next', exact: true }).click();
          await expect(card).toContainText('Live');
        }
      });
  });
}
