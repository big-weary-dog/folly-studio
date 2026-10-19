// npm run smoke: the app in a browser, the way a person meets it, at a laptop's size and a phone's: sign up, an idea
// the sketch generator turns into a look, the Studio in the Playa view with the sandbox running, a param dragged and
// stepped, a typo and a hang in the code (reported, paused by the watchdog, running again once fixed), the timeline,
// a layer's body played in an accent (the pick tile), and a bake in the real render box (the laptop bakes from the
// Studio; the phone says to bake from a larger screen and plays the baked frames).
// The real server and a fresh build (studio.js); WebGL on SwiftShader. Every request stays on our origin, and the
// console stays free of errors and CSP reports. Screenshots of each step land in the test's output folder.
import { createRenderBox } from '../../src/render-box.ts';
import { expect, quiet, test } from './studio.js';

const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const IDEA = 'Rising embers drift up the spires while the rose window glows';
const HANG = 'function pixel(p, t) {\n  while (true) {}\n}\n';
const BAKE = /^(?:Save & bake|Bake|Bake again)$/;

for (const [name, device] of Object.entries(SIZES)) {
  test.describe(`${name}, ${device.viewport.width} × ${device.viewport.height}`, () => {
    test.use(device);

    test('sign up → idea → Studio (Playa) → code error → timeline → bake', async ({ page, studio }, info) => {
      const { origin } = studio;
      const wide = name === 'laptop';
      const shots = [];
      const shot = async (step) => {
        const file = info.outputPath(`${shots.length + 1}-${step}.png`);
        await page.screenshot({ path: file, timeout: 60_000 });
        shots.push(file);
        await info.attach(step, { path: file, contentType: 'image/png' });
      };
      const external = [], errors = [];
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(origin) || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
        external.push(url);
        return route.abort();
      });
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      // A tab on the phone, a panel of the dock on the laptop.
      const open = (tab, dock) => (wide ? page.locator('.dock-tab', { hasText: dock })
        : page.locator(`.tab[data-tab=${tab}]`)).click();

      await test.step('sign up', async () => {
        await page.goto(`${origin}/`);
        await page.getByRole('button', { name: 'Sign up' }).click();
        await page.fill('input[name=username]', `smoke-${name}`);
        await page.fill('input[name=password]', 'correct horse');
        await page.locator('form button[type=submit]').click();
        await expect(page.locator('textarea.idea-input')).toBeVisible({ timeout: 20_000 });
      });

      await test.step('an idea becomes a look', async () => {
        await page.fill('textarea.idea-input', IDEA);
        await page.getByRole('button', { name: 'Turn it into a look' }).click();
        const studioLink = page.getByRole('link', { name: 'Open in Studio' }).first();
        await expect(studioLink).toBeVisible({ timeout: 60_000 });
        await studioLink.click();
        await expect(page).toHaveURL(/\/studio\/[\w-]+$/);
      });

      await test.step('the Studio, in the Playa view, with the sandbox running', async () => {
        await expect(page.locator('iframe.sandbox-frame')).toHaveAttribute('src', /^\/assets\/sandbox-[\w-]+\.html$/);
        await expect(page.locator('.mode-btn[data-mode=playa]:visible').first())
          .toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
        await expect(page.locator('.tp-stats')).toHaveText(/\d+ fps/, { timeout: 30_000 });
        const canvas = await page.locator('canvas:visible').first().evaluate((c) => [c.width, c.height]);
        expect(canvas.every((n) => n > 0), `the 3D view's canvas is ${canvas.join(' × ')}`).toBe(true);
        await shot('studio');
      });

      await test.step('a param is one field: dragged across, stepped by a key', async () => {
        await page.locator('.layer-name:visible').first().click();
        const field = page.locator('.params .scrub:visible').first(), min = await field.getAttribute('aria-valuemin');
        await field.dragTo(page.locator('.params .field:has(.scrub) > label:visible').first());   // past its left end
        await expect(field).toHaveAttribute('aria-valuenow', min);
        await field.click();
        await page.keyboard.press('ArrowUp');
        await expect(field).not.toHaveAttribute('aria-valuenow', min);
        await shot('params');
        await page.locator('.save-btn:visible').click();
        await expect(page.locator('.studio.is-dirty')).toHaveCount(0);
      });

      await test.step('the code: a typo is reported, a hang paused, the fix runs again', async () => {
        await open('code', 'Code');
        const code = page.locator('textarea.code:visible').first();
        const problem = page.locator('.editor .problem:visible').first();
        const original = await code.inputValue();
        await code.fill(`${original}\nfunction broken( {`);
        await expect(problem).toHaveText(/\S/, { timeout: 10_000 });
        await shot('code-error');
        await code.fill(HANG);
        await expect(problem).toHaveText(/hung/i, { timeout: 20_000 });
        await code.fill(original);
        await expect(page.locator('.editor .problem:visible', { hasText: /\S/ })).toHaveCount(0, { timeout: 15_000 });
        const late = await page.evaluate(() => new Promise((resolve) => {
          const t0 = performance.now();
          setTimeout(() => resolve(performance.now() - t0), 50);
        }));
        expect(late, 'a 50 ms timer on the page, ms (the page stays responsive)').toBeLessThan(1000);
      });

      await test.step('the timeline', async () => {
        await open('time', 'Timeline');
        await expect(page.locator('.tl-rows:visible').first()).toBeVisible();
        await shot('timeline');
      });

      await test.step("colours: the layer's body played in an accent", async () => {
        if (!wide) await page.locator('.tab[data-tab=layers]').click();
        const chip = page.locator('.role-chip:visible', { hasText: 'body' });
        await chip.click();
        await page.locator('.pick-pop:popover-open .pick-cell[aria-label=accent1]').click();
        await shot('colours');
        await page.keyboard.press('Escape');
        await expect(page.locator('.pick-pop:popover-open')).toHaveCount(0);
        await expect(chip).toHaveClass(/remapped/);
      });

      await test.step('bake', async () => {
        const probe = await createRenderBox({ log: quiet }).probe();
        test.skip(!probe.ok, `render box unavailable here: ${probe.reason}`);
        await open('look', 'Look');
        const bake = page.locator('section.bake:visible');
        const pill = bake.locator('.bake-pill');
        if (wide) {
          await bake.getByRole('button', { name: BAKE }).click();
        } else {
          // The phone bakes nothing itself; the look is baked where the laptop would, then played here.
          await expect(bake.getByText('Bake and review from a larger screen.')).toBeVisible();
          await expect(bake.getByRole('button', { name: BAKE })).toBeHidden();
          const id = new URL(page.url()).pathname.split('/').pop();
          expect((await page.request.post(`${origin}/api/looks/${id}/bake`, { data: {} })).status()).toBe(202);
          await expect.poll(async () => (await (await page.request.get(`${origin}/api/looks/${id}`)).json()).look
            .bake?.status, { timeout: 120_000 }).toBe('done');
          await page.reload();
          await open('look', 'Look');
        }
        await expect(pill).toHaveText('Passed', { timeout: 120_000 });
        const play = bake.locator('.bake-play');
        const badge = page.locator('.baked-badge');
        await play.click();
        await expect(badge.or(play.filter({ hasText: /MB/ }))).toBeVisible({ timeout: 60_000 });
        if (!(await badge.isVisible())) await play.click();   // on a phone's connection the first press says the size
        await expect(badge).toBeVisible({ timeout: 60_000 });
        await expect(play).toHaveAttribute('aria-pressed', 'true');
        await shot('baked');
      });

      expect(external, 'requests that left our origin').toEqual([]);
      expect(errors.filter((e) => !/Failed to load resource: the server responded with a status of 40[14]/.test(e)),
        'console errors and CSP reports').toEqual([]);
    });
  });
}
