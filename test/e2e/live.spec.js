// npm run smoke, too: the live stage in browsers. A curator on a phone plays a reviewed look from /live/control; a
// laptop and a phone watching /live show it, and compute the same frame for the same show time (the stage's probe:
// each frame's sum by index on a quarter-second grid, which slow and fast viewers alike compute); Intensity to 0
// darkens both within the stage's lead. Screenshots of each, and a frame sequence of the push landing, in the output.
import { writeFileSync } from 'node:fs';

import { expect, signup, test } from './studio.js';

const LAPTOP = { viewport: { width: 1366, height: 768 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const CODE = 'function pixel(p, t) {\n  return [0.5 + 0.5 * Math.sin(t * 3 + p.x * 4), 0.25, 0.5 + 0.5 * Math.cos(t * 2'
  + ' + p.y * 3)];\n}\n';
test.use({ serverOptions: { curators: 'conductor' } });

/** A signed-in browser context of `device`, its page on `path`. */
async function person(browser, origin, cookie, device, url) {
  const ctx = await browser.newContext(device);
  const [name, value] = cookie.split('=');
  await ctx.addCookies([{ name, value, url: origin }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${origin}${url}`);
  return { ctx, page, errors };
}
/** The probe's frames: [index, sum] pairs. */
const frames = (page) => page.evaluate(() => [...window.__liveProbe.frames]);

test('two viewers see the same frame; a push from the phone lands on both', async ({ browser, studio }, info) => {
  const { origin, app } = studio;
  const shot = (page, step) => page.screenshot({ path: info.outputPath(`${step}.png`), timeout: 60_000 });
  const owner = await signup(origin, 'painter'), conductor = await signup(origin, 'conductor');
  const res = await fetch(`${origin}/api/looks`, { method: 'POST', headers: { 'content-type': 'application/json',
    cookie: owner }, body: JSON.stringify({ title: 'Tide on the spires', shared: true, duration: 20,
    layers: [{ id: 'l1', title: 'Tide', code: CODE, groups: ['cathedral'], blend: 'add', level: 1 }] }) });
  expect(res.status).toBe(201);
  const { look } = await res.json();
  app.store.looks.update(look.id, { reviewed: true });      // passed a bake's flash check at review, as a curator does

  const laptop = await person(browser, origin, await signup(origin, 'watcher'), LAPTOP, '/live?probe=1');
  const phone = await person(browser, origin, await signup(origin, 'pocket'), PHONE, '/live?probe=1');
  const control = await person(browser, origin, conductor, PHONE, '/live/control');
  const viewers = [laptop, phone];

  await test.step('nothing plays yet; the curator plays a look from the phone', async () => {
    for (const v of viewers) {
      await expect(v.page.locator('.viewer-msg')).toHaveText('Nothing is playing yet.', { timeout: 60_000 });
    }
    const pick = control.page.getByLabel('Look to play');
    await expect(pick.locator('option')).toHaveText(['Pick a look…', 'Tide on the spires · painter']);
    await pick.selectOption(look.id);
    await control.page.getByRole('button', { name: 'Play' }).click();
    await expect(control.page.locator('h1')).toHaveText('Tide on the spires');
    for (const v of viewers) await expect(v.page.locator('.live-title')).toHaveText('Tide on the spires');
    await expect(laptop.page.locator('.live-bar')).toContainText('3 watching');      // the controller's socket too
  });

  await test.step('both viewers compute the same frames', async () => {
    await expect.poll(async () => (await frames(phone.page)).length, { timeout: 60_000 }).toBeGreaterThan(30);
    await expect.poll(async () => {
      const a = new Map(await frames(laptop.page)), b = await frames(phone.page);
      const shared = b.filter(([i]) => a.has(i));
      const same = shared.filter(([i, sum]) => Math.abs(a.get(i) - sum) <= 1e-6 * Math.abs(sum));
      return shared.length >= 10 && same.length === shared.length ? 'same' : `${same.length} of ${shared.length}`;
    }, { timeout: 30_000 }).toBe('same');
    await shot(laptop.page, 'laptop-live');
    await shot(phone.page, 'phone-live');
    await shot(control.page, 'phone-control');
  });

  await test.step('Intensity to 0 on the phone: both go dark', async () => {
    const fader = control.page.getByRole('slider', { name: 'Intensity' });
    await expect(fader).toHaveAttribute('aria-valuenow', '1');
    await Promise.all(viewers.map((v, n) => shot(v.page, `push-0-before-${n ? 'phone' : 'laptop'}`)));
    const lit = Math.max(...(await frames(laptop.page)).map(([, sum]) => sum));
    expect(lit).toBeGreaterThan(0);
    const box = await fader.boundingBox();
    const sent = Date.now();
    await control.page.touchscreen.tap(box.x + 1, box.y + box.height / 2);
    // Dark: a frame below 2 % of the brightest before the push, on each viewer; when it showed, after the tap.
    const landed = await Promise.all(viewers.map(async (v) => {
      await v.page.waitForFunction((max) => [...window.__liveProbe.frames.values()].some((sum) => sum < max * 0.02),
        lit, { timeout: 10_000, polling: 'raf' });
      return Date.now() - sent;
    }));
    const timing = info.outputPath('push-landed.txt');
    writeFileSync(timing, `ms after the tap until dark: laptop ${landed[0]}, phone ${landed[1]}\n`);
    await info.attach('push landed', { path: timing, contentType: 'text/plain' });
    for (let i = 1; i <= 2; i++) {
      await Promise.all(viewers.map((v, n) => shot(v.page, `push-${i}-after-${n ? 'phone' : 'laptop'}`)));
    }
    await expect(fader).toHaveAttribute('aria-valuenow', /^0\.0/);
    await shot(control.page, 'phone-control-pushed');
  });

  for (const p of [laptop, phone, control]) {
    expect(p.errors).toEqual([]);
    await p.ctx.close();
  }
});
