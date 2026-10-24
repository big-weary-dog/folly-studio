// Audit regressions: drafts, inherited limits, invitation entry, reporting eligibility and tutorial availability.
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

    test('drafts survive cancelled navigation and Defaults clears a saved override', async ({ page, studio }) => {
      const cookie = await signup(studio.origin, `pages-admin-${width}`);
      const [name, value] = cookie.split('=');
      await page.context().addCookies([{ name, value, url: studio.origin }]);
      const member = `pages-member-${width}`;
      await signup(studio.origin, member);
      await page.goto(`${studio.origin}/admin/models`);
      if (width < 900) {
        await expect(page.locator('.model-row')).toHaveCount(0);
        await page.getByRole('combobox', { name: 'Admin page' }).selectOption('access');
        await expect(page.locator('.access-row')).toHaveCount(0);
        await page.getByRole('searchbox', { name: 'Search people' }).fill(member);
        const person = page.locator('.access-row', { hasText: member });
        await person.getByRole('button', { name: 'Unlock', exact: true }).click();
        await expect(person).toContainText('unlocked');
        await expect(person.getByRole('button', { name: 'Limits', exact: true })).toBeHidden();
        await expect(person.getByRole('button', { name: 'Reset', exact: true })).toBeHidden();
        await shot(page, 'access-quick-unlock');
        await page.getByRole('combobox', { name: 'Admin page' }).selectOption('reports');
        await expect(page.getByRole('button', { name: 'Report a problem', exact: true })).toBeVisible();
        await expect(page.locator('.report-list')).toHaveCount(0);
        return;
      }
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
        if (width < 900) await expect(page.getByText(/needs an invite code/)).toBeHidden();
        else await expect(page.getByText(/needs an invite code/)).toBeVisible();
        await shot(page, 'signup');
        await page.keyboard.press('F8');
        await expect(page.getByRole('dialog', { name: 'Report a problem' })).toHaveCount(0);
        await expect(page.getByText(/Reporting a problem needs an account/).last()).toBeVisible();
        await shot(page, 'report-signedout');
        await page.getByText(/Reporting a problem needs an account/).hover();
        await page.fill('input[name=username]', `pages-locked-${width}`);
        await page.fill('input[name=password]', 'correct horse');
        await page.locator('input[name=password]').press('Enter');
        await expect(page.getByRole('button', { name: 'Enter invite code' })).toBeVisible();
        await expect(page.getByText(/Reporting a problem needs an account/)).toHaveCount(0);
        await shot(page, 'locked-looks');
        await page.keyboard.press('F8');
        const report = page.getByRole('dialog', { name: 'Report a problem' });
        await expect(report).toBeVisible();
        await report.getByLabel('What went wrong?').fill('A locked account can report without an AI invite.');
        await shot(page, 'report-locked');
        const sent = page.waitForResponse((r) => r.url().endsWith('/api/reports') && r.request().method() === 'POST');
        await report.getByRole('button', { name: 'Send', exact: true }).click();
        expect((await sent).status()).toBe(201);
        await expect(report).toContainText('Sent. Thanks!');
        await expect(report).toBeHidden();
        await page.getByRole('button', { name: 'Enter invite code' }).click();
        await expect(page.getByRole('dialog', { name: 'Invite code' })).toBeVisible();
        await page.keyboard.press('Escape');
        await menu(page);
        const tutorials = page.getByRole('button', { name: 'Tutorials', exact: true });
        if (width < 900) await expect(tutorials).toBeHidden();
        else await expect(tutorials).toBeVisible();
        const logOut = page.getByRole('button', { name: 'Log out', exact: true });
        for (const button of ['Invite code', 'Report a problem', 'Log out']) {
          const box = await page.getByRole('button', { name: button, exact: true }).boundingBox();
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
        await shot(page, 'account-menu');
        await logOut.click();
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
