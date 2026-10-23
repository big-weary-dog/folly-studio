// Relay to the lights (SPEC-live "Relay to the lights") on the Pi profile, against the real engine in a dry run: a
// curator's /live renders a live library look and the engine plays its frames, steady (its stats line says the relay
// is on and missing next to nothing), then lets go. Screenshots at a laptop's and a phone's size, in RELAY_SHOTS when
// it names a folder.
import path from 'node:path';

import { expect, signup, test } from './dry-engine.js';

const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 }, colorScheme: 'dark' },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    colorScheme: 'dark' },
};
const PIXEL = 'function pixel(p, t, P) { return [p.x, p.y, p.z]; }';
test.use({ engineScenario: 'relay' });

test('a curator relays a live look to the lights, steady, and lets go', async ({ browser, studio, dryEngine },
  info) => {
  const { origin } = studio;
  const relayed = () => dryEngine.output.stats().relay;
  const cara = await signup(origin, 'cara'), boss = await signup(origin, 'boss');
  const call = async (method, url, body, cookie = cara) => (await fetch(`${origin}${url}`, { method,
    body: JSON.stringify(body), headers: { 'content-type': 'application/json', cookie } })).json();
  await call('PUT', '/api/admin/lights', { mode: 'live' }, boss);
  const look = (await call('POST', '/api/looks', { title: 'Relayed fire', layers: [{ id: 'l1', title: 'Fire',
    groups: ['cathedral'], modules: [{ id: 'a', kind: 'source', title: 'Fire', ref: 'fire', code: PIXEL }] }] })).look;
  await expect.poll(async () => (await call('GET', '/api/lights')).engine).toBe(true);
  expect(await call('POST', '/api/lights/queue', { lookId: look.id, at: 'now' })).toEqual({ kind: 'live' });
  const dir = process.env.RELAY_SHOTS;
  const shot = (page, name) => page.screenshot({ path: dir ? path.join(dir, `${name}.png`)
    : info.outputPath(`${name}.png`) });

  for (const size of ['laptop', 'phone']) {
    const ctx = await browser.newContext(SIZES[size]);
    const [name, value] = cara.split('=');
    await ctx.addCookies([{ name, value, url: origin }]);
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${origin}/live`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Relayed fire', { timeout: 10_000 });
    if (size === 'phone') await page.getByRole('button', { name: 'The Folly in 3D' }).click();
    const panel = page.getByRole('group', { name: 'Relay to the lights' });
    // The 3D view draws on the canvas the page shows (the live play page mounts its aside anew once the state is in).
    // Sized to its box, so drawn into (a canvas left behind would keep the default 300 × 150).
    await expect.poll(() => page.locator('.live-viewer canvas').evaluate((c) => Math.abs(c.width / c.height
      - c.clientWidth / c.clientHeight) < 0.02), { timeout: 30_000 }).toBe(true);
    await expect(page.locator('.viewer-msg')).toBeHidden({ timeout: 60_000 });
    await panel.getByRole('checkbox', { name: 'Relay to the lights' }).check();
    await expect(panel.getByRole('status')).toContainText('Relaying', { timeout: 30_000 });
    // Steady: the engine plays the page's frames, missing next to nothing once the relay is on.
    await expect.poll(() => relayed()?.on, { timeout: 15_000 }).toBe(true);
    expect(relayed().by).toBe('cara');
    const missed = relayed().missed;
    await page.waitForTimeout(5000);
    expect(relayed().on).toBe(true);
    expect(relayed().missed - missed, 'missed in 5 s').toBeLessThanOrEqual(4);
    await expect(panel.getByRole('status')).toContainText('ms ahead');
    await expect(page.locator('.viewer-msg')).toBeHidden({ timeout: 60_000 });
    await shot(page, `relay-${size === 'laptop' ? 1366 : 390}`);
    await panel.getByRole('checkbox', { name: 'Relay to the lights' }).uncheck();
    await expect.poll(() => relayed(), { timeout: 5000 }).toBeNull();
    expect(errors).toEqual([]);
    await ctx.close();
  }
});
