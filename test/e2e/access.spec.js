// npm run smoke, too: access to the paid models in a browser at a laptop's and a phone's size. A new (locked) account
// sees no AI: no Ideas, no Refine; its user menu takes an invite code, a wrong one refused, a good one bringing Ideas
// back; a limit reached from elsewhere (a stale page) shows when the next idea may
// go; an admin makes a code on the Access page, with its invite link. The link (/#invite=CODE) signs a visitor up and
// redeems the code, or redeems it at once when signed in, says why a bad one was refused, and leaves no code in the
// address or the tab. A session that ends on the Admin page goes back to sign-in. The paid models are a stand-in
// codex CLI (test/fixtures/generate/bin/codex).
import { fileURLToPath } from 'node:url';

import { expect, test } from './studio.js';

const BIN = fileURLToPath(new URL('../fixtures/generate/bin/', import.meta.url));
const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
test.use({ serverOptions: { admins: 'keeper-laptop,keeper-phone', models: { codexBin: `${BIN}codex`,
  env: { ...process.env, ANTHROPIC_API_KEY: '', PATH: `${BIN}:${process.env.PATH}` } } } });

/** Signs up `username`: on to Ideas, or (`locked`) My looks without the AI. */
async function signUp(page, origin, username, { locked = false } = {}) {
  await page.goto(`${origin}/login`);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.fill('input[name=username]', username);
  await page.fill('input[name=password]', 'correct horse');
  await page.locator('form button[type=submit]').click();
  await expect(page).toHaveURL(`${origin}${locked ? '/looks' : '/ideas'}`, { timeout: 20_000 });
}
/** The user menu: a popover at a laptop's width, in the nav panel on a phone. */
async function userMenu(page) {
  const phone = (page.viewportSize()?.width ?? 0) < 900;
  await page.locator(phone ? '#nav-toggle' : '#user-menu-btn').click();
}

for (const [name, device] of Object.entries(SIZES)) {
  test.describe(`${name}, ${device.viewport.width} × ${device.viewport.height}`, () => {
    test.use(device);

    test('locked, redeemed, at a limit; an admin makes a code', async ({ page, studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const shot = (step) => page.screenshot({ path: info.outputPath(`${step}.png`), timeout: 60_000 });
      const { app } = studio, pick = page.locator('.model-pick select'), gate = page.locator('.gate');
      const submit = page.getByRole('button', { name: 'Turn it into a look' });

      const nav = page.locator('.main-nav'), toast = page.locator('.toast-msg').last();
      const redeem = async (code) => {
        await userMenu(page);
        await page.getByRole('button', { name: 'Invite code' }).click();
        const dialog = page.getByRole('dialog', { name: 'Invite code' });
        await dialog.getByRole('textbox', { name: 'Code' }).fill(code);
        await dialog.getByRole('button', { name: 'Redeem' }).click();
      };

      await test.step('a new account: no AI anywhere, and an invite code in its menu', async () => {
        await signUp(page, studio.origin, `guest-${name}`, { locked: true });
        await expect(nav.locator('a[href="/ideas"]')).toHaveCount(0);
        await page.goto(`${studio.origin}/ideas`);
        await expect(page).toHaveURL(`${studio.origin}/looks`);
        await page.goto(`${studio.origin}/studio`);
        await expect(page.locator('li.layer').first()).toBeVisible({ timeout: 60_000 });
        await page.keyboard.press('Control+s');
        await expect(toast).toHaveText('Saved.');
        await expect(page).toHaveURL(/\/studio\/[^/]+$/);
        await expect(page.locator('.refine')).toHaveCount(0);
        await shot('locked');
      });

      await test.step('a wrong code is refused; a good one brings the AI', async () => {
        await redeem('AAAA-BBBB-CCCC');
        await expect(toast).toContainText('That code is not valid');
        await page.locator('.toast-close').last().click().catch(() => {});
        await shot('redeem-wrong');
        await redeem(app.access.createInvite('keeper', { uses: 1 }).code.toLowerCase());
        await expect(toast).toHaveText('Invite accepted: you can use Sol and Luna.');
        await expect(nav.locator('a[href="/ideas"]')).toHaveCount(1);
        await page.goto(`${studio.origin}/ideas`);
        await expect(page.locator('.gate-left')).toHaveText('6 left this hour · 20 today');
        await expect(pick.locator('option')).toHaveText(['Sol', 'Luna']);
        await page.fill('textarea.idea-input', 'Embers rising up the spires');
        await shot('unlocked');
      });

      await test.step('a limit reached elsewhere (a stale page) shows on submit as the wait', async () => {
        const me = app.store.users.list((u) => u.username === `guest-${name}`)[0];
        app.access.patch(me, 'keeper', { limits: { perHour: 1 } });
        app.store.ideas.create({ owner: me.id, text: 'from another tab', model: 'sol', status: 'ready' });
        await expect(page.locator('.gate-left')).toHaveText('6 left this hour · 20 today'); // as this page last saw
        await submit.click();
        await expect(gate).toContainText(/That's all your ideas for this hour\. Next idea (tomorrow )?at \d/);
        await expect(submit).toBeDisabled();
        await expect(page.locator('.idea-form > .form-error')).toBeHidden();
        await shot('at-limit');
      });

      await test.step('an admin makes a code on the Access page', async () => {
        await page.context().clearCookies();
        await signUp(page, studio.origin, `keeper-${name}`);
        await page.goto(`${studio.origin}/admin/access`);
        await page.getByLabel('Label').fill(`Art crew (${name})`);
        await page.getByLabel('Uses').fill('5');
        await page.getByLabel('Expires in days').fill('14');
        await page.getByRole('button', { name: 'Make a code' }).click();
        const fresh = page.locator('.fresh-code code').first();
        await expect(fresh).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
        await expect(page.locator('.invite-link')).toHaveText(`${studio.origin}/#invite=${await fresh.textContent()}`);
        await page.getByRole('button', { name: 'Copy invite link' }).click();
        await expect(page.locator('.toast-msg').last()).toHaveText(/Copied\.|Copy it by hand\./);
        await expect(page.locator('.access-row', { hasText: `Art crew (${name})` })).toContainText('0 of 5 used');
        await expect(page.locator('.access-row', { hasText: `guest-${name}` })).toContainText('unlocked');
        await shot('access');
      });

      await test.step('a session that ends on the Access page goes back to sign-in, with no error', async () => {
        await page.locator('a[data-tab=light]').click();
        // Loaded, so its own call is done before the session ends and the 401 is Access's.
        await expect(page.locator('.light-page')).not.toContainText('Loading…');
        await page.context().clearCookies();
        await page.locator('a[data-tab=access]').click();
        await expect(page).toHaveURL(`${studio.origin}/login?next=${encodeURIComponent('/admin/access')}`);
        await expect(page.locator('.toast-error')).toHaveCount(0);
      });
      expect(errors).toEqual([]);
    });

    test('an invite link: signed out, signed in, and a code that is used up', async ({ page, studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const shot = (step) => page.screenshot({ path: info.outputPath(`${step}.png`), timeout: 60_000 });
      const { app } = studio, pick = page.locator('.model-pick select'), toast = page.locator('.toast-msg').last();
      const link = (code) => `${studio.origin}/#invite=${encodeURIComponent(code)}`;
      const kept = () => page.evaluate(() => sessionStorage.length);
      const first = app.access.createInvite('keeper', { uses: 1 }).code;

      await test.step('signed out: the sign-up screen says so, and signing up redeems it', async () => {
        await page.goto(link(first));
        await expect(page).toHaveURL(`${studio.origin}/login`);
        await expect(page.locator('.auth-invited')).toContainText("You've been invited.");
        await expect(page.getByRole('button', { name: 'Sign up' })).toHaveAttribute('aria-pressed', 'true');
        await shot('invited');
        await page.fill('input[name=username]', `linked-${name}`);
        await page.fill('input[name=password]', 'correct horse');
        await page.locator('form button[type=submit]').click();
        await expect(toast).toHaveText('Invite accepted: you can use Sol and Luna.');
        await expect(pick.locator('option')).toHaveText(['Sol', 'Luna']);
        await expect(page).toHaveURL(`${studio.origin}/ideas`);
        expect(await kept()).toBe(0);
        await shot('invite-accepted');
      });

      await test.step('signed in: a used-up code says so; a good one redeems at once', async () => {
        await page.context().clearCookies();
        await signUp(page, studio.origin, `later-${name}`, { locked: true });
        await page.goto(link(first));
        await expect(toast).toHaveText('Invite not accepted. That code is used up: ask for a new one.');
        await expect(page).toHaveURL(`${studio.origin}/looks`);
        expect(await kept()).toBe(0);
        await shot('invite-refused');
        await page.goto(link(app.access.createInvite('keeper', { uses: 1 }).code));
        await expect(toast).toHaveText('Invite accepted: you can use Sol and Luna.');
        await expect(pick.locator('option')).toHaveText(['Sol', 'Luna']);
        await expect(page).toHaveURL(`${studio.origin}/ideas`);
      });
      expect(errors).toEqual([]);
    });
  });
}
