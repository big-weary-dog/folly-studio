// npm run smoke, too: how an idea was made (SPEC-generators "How it was made"), at a laptop's and a phone's size. Its
// owner follows it live from the row's "Watch it" (the running round folded, its thinking inside), then reads the
// rounds once it is ready, folded and not; an admin sees the same idea with the shared prompt and errors. A stand-in
// codex CLI (test/fixtures/generate/bin/codex) thinks first and answers slowly.
import { fileURLToPath } from 'node:url';

import { expect, test } from './studio.js';

const BIN = fileURLToPath(new URL('../fixtures/generate/bin/', import.meta.url));
const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const THINKING = 'The idea asks for a tide: slow, wide, one gesture. Blue rising up the spires reads as water from '
  + 'the plaza; a wave along the height, a long period, nothing that flashes.';
test.use({ serverOptions: { admins: 'aimode-admin-laptop,aimode-admin-phone', models: { codexBin: `${BIN}codex`,
  env: { ...process.env, ANTHROPIC_API_KEY: '', PATH: `${BIN}:${process.env.PATH}` } } } });
// The codex adapter passes its own process's environment on (the server runs in this worker): slow, and thoughtful.
const FAKE = { CODEX_FAKE_MODE: 'slow', CODEX_FAKE_DELAY: '5000', CODEX_FAKE_THINKING: THINKING };
test.beforeAll(() => { Object.assign(process.env, FAKE); });
test.afterAll(() => { for (const k of Object.keys(FAKE)) delete process.env[k]; });

async function signUp(page, url, username) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.fill('input[name=username]', username);
  await page.fill('input[name=password]', 'correct horse');
  await page.locator('form button[type=submit]').click();
  await expect(page.locator('textarea.idea-input')).toBeVisible({ timeout: 20_000 });
}

for (const [name, device] of Object.entries(SIZES)) {
  test.describe(`${name}, ${device.viewport.width} × ${device.viewport.height}`, () => {
    test.use(device);

    test('watched live, then read after; an admin sees more', async ({ page, browser, studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const shot = (p, step) => p.screenshot({ path: info.outputPath(`${step}.png`), timeout: 60_000 });
      const { code } = studio.app.access.createInvite('keeper', { uses: 1 });
      await signUp(page, `${studio.origin}/#invite=${encodeURIComponent(code)}`, `aimode-${name}`);
      const head = page.locator('.ai-head .ai-label'), live = page.locator('.ai-round.is-live');

      await test.step('live: the running round folded, its thinking inside', async () => {
        await page.locator('.explore .seg-btn').filter({ hasText: 'Quick' }).click();
        await page.fill('textarea.idea-input', 'A slow tide of blue up the spires');
        await page.getByRole('button', { name: 'Turn it into a look' }).click();
        await page.locator('.idea').first().getByRole('link', { name: 'Watch it' }).click();
        await expect(head).toHaveText('Making your idea');
        await expect(live).toBeVisible({ timeout: 20_000 });
        await expect(live).not.toHaveAttribute('open');
        await expect(live.locator('.ai-outcome')).toHaveText('Thinking…');
        await shot(page, 'live-folded');
        await live.locator('summary').click();
        await expect(live.locator('.ai-think-text')).toContainText('slow, wide, one gesture', { timeout: 10_000 });
        await shot(page, 'live-open');
      });

      await test.step('after: the rounds, the latest open; folded', async () => {
        await expect(head).toHaveText('How your idea was made', { timeout: 60_000 });
        await expect(live).toHaveCount(0);
        await expect(page.locator('.ai-round[open]')).toHaveCount(1);
        await expect(page.locator('.ai-round').last()).toHaveAttribute('open', '');
        await expect(page.locator('.ai-round[open] .ai-plan')).toContainText('One slow blue layer');
        await expect(page.locator('.ai-round').first().locator('.ai-edits')).toContainText('a sky drifts');
        await expect(page.locator('.ai-part').first()).toBeAttached();
        await page.locator('.ai-prompt > summary').click();
        await expect(page.locator('.ai-locked').first()).toBeAttached();
        await shot(page, 'owner');
        const all = page.getByRole('button', { name: /Collapse all|Expand all/ });
        if (await all.count()) {
          if ((await all.textContent()) === 'Expand all') await all.click();
          await all.click();
          await expect(page.locator('.ai-round[open]')).toHaveCount(0);
        } else await page.locator('.ai-round > summary').first().click();
        await shot(page, 'folded');
      });

      await test.step('an admin: the shared prompt in full, and its numbers', async () => {
        const context = await browser.newContext(device), admin = await context.newPage();
        admin.on('pageerror', (e) => errors.push(String(e)));
        await signUp(admin, `${studio.origin}/login`, `aimode-admin-${name}`);
        await admin.goto(page.url());
        await expect(admin.locator('.ai-head .ai-label')).toHaveText('How this idea was made');
        await admin.locator('.ai-prompt > summary').click();
        await admin.locator('.ai-part > summary').first().click();
        await expect(admin.locator('.ai-part .ai-pre').first()).toBeVisible();
        await shot(admin, 'admin');
        await context.close();
      });
      expect(errors).toEqual([]);
    });
  });
}
