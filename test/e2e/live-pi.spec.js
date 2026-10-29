// npm run smoke, too: the Live tab following /pi (SPEC-live "Following /pi"). An admin on a phone picks a look on /pi
// (the dry-run engine behind Studio's proxy); the Live tab, on a phone and a laptop, plays it and says it is driven
// from /pi, and /pi says so too. Screenshots of each, and /pi beside the Live tab, in the output.
import { readFileSync } from 'node:fs';

import { expect, signup, test } from './dry-engine.js';

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  colorScheme: 'dark' };
const LAPTOP = { viewport: { width: 1366, height: 768 }, colorScheme: 'dark' };

test.use({ engineScenario: 'live-pi', engineServerOptions: { admins: 'boss' } });

async function person(browser, origin, cookie, device, url) {
  const ctx = await browser.newContext(device);
  const [name, value] = cookie.split('=');
  await ctx.addCookies([{ name, value, url: origin }]);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${origin}${url}`);
  return { ctx, page, errors };
}
const lit = (page) => page.evaluate(() => Math.max(0, ...[...window.__liveProbe.frames.values()].slice(-20)));

test('a look picked on /pi plays on the Live tab', async ({ browser, studio }, info) => {
  const { origin } = studio;
  const boss = await signup(origin, 'boss');
  const pi = await person(browser, origin, boss, PHONE, '/pi/');
  const live = await person(browser, origin, await signup(origin, 'watcher'), PHONE, '/live?probe=1');
  const laptop = await person(browser, origin, await signup(origin, 'desk'), LAPTOP, '/live?probe=1');
  const studioTab = pi.page.locator('.lp-stats div', { hasText: 'Studio\'s Live tab' });
  await expect(studioTab).toContainText('Driven from Live control');
  await expect(live.page.locator('.live-driver')).toHaveText('driven from Live control');

  await pi.page.getByRole('button', { name: /^Up next/ }).click();
  await pi.page.getByRole('button', { name: /Add a look/ }).click();
  await pi.page.getByRole('searchbox', { name: 'Find a look' }).fill('Fire');
  await pi.page.getByRole('button', { name: /^Fire/ }).click();
  await pi.page.getByRole('button', { name: 'Cue it' }).click();
  await expect(pi.page.getByText('The looks overlap for 4 s.', { exact: false })).toBeVisible();
  await pi.page.screenshot({ path: info.outputPath('pi-crossfade-390.png') });
  await pi.page.setViewportSize(LAPTOP.viewport);
  await pi.page.screenshot({ path: info.outputPath('pi-crossfade-1366.png') });
  await pi.page.setViewportSize(PHONE.viewport);
  await pi.page.getByRole('button', { name: /^Fade to Fire/ }).click();
  await expect(pi.page.getByRole('heading', { level: 1 })).toHaveText('Fire', { timeout: 10_000 });
  await expect(studioTab).toContainText('Driven from /pi');
  for (const v of [live, laptop]) {
    await expect(v.page.locator('.live-title')).toHaveText('Fire', { timeout: 30_000 });
    await expect(v.page.locator('.live-driver')).toHaveText('driven from /pi');
    await expect.poll(() => lit(v.page), { timeout: 60_000 }).toBeGreaterThan(0);
  }

  const files = { pi: info.outputPath('pi-phone.png'), live: info.outputPath('live-phone.png') };
  await Promise.all([pi.page.screenshot({ path: files.pi }), live.page.screenshot({ path: files.live }),
    laptop.page.screenshot({ path: info.outputPath('live-laptop.png') })]);
  // /pi beside the Live tab, one picture.
  const side = await (await browser.newContext({ viewport: { width: 800, height: 860 } })).newPage();
  const img = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  await side.setContent(`<body style="margin:0;background:#111;display:flex;gap:20px;padding:8px">
    <img src="${img(files.pi)}" width="390"><img src="${img(files.live)}" width="390"></body>`);
  await side.screenshot({ path: info.outputPath('pi-beside-live.png') });
  for (const v of [pi, live, laptop]) expect(v.errors).toEqual([]);
});
