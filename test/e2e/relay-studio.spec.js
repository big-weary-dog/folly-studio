// Relay from Studio's editor (SPEC-live "From Studio's editor") on the Pi profile, against the real engine in a dry
// run: a curator turns To the lights on in the preview's transport, over the look the lights play, and an unsaved
// edit to the code reaches them (the engine's power reading follows it). Screenshots at a laptop's and a phone's
// size, in RELAY_SHOTS when it names a folder.
import path from 'node:path';

import { expect, signup, test } from './dry-engine.js';

const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 }, colorScheme: 'dark' },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    colorScheme: 'dark' },
};
const pixel = (v) => `function pixel(p, t, P) { return [${v}, ${v}, ${v}]; }`;
test.use({ engineScenario: 'relay-studio' });

test('a curator sends the look being edited to the lights; an unsaved edit reaches them', async ({ browser, studio,
  dryEngine }, info) => {
  const { origin } = studio;
  const stats = () => dryEngine.output.stats();
  const cara = await signup(origin, 'cara'), boss = await signup(origin, 'boss');
  const call = async (method, url, body, cookie = cara) => (await fetch(`${origin}${url}`, { method,
    body: JSON.stringify(body), headers: { 'content-type': 'application/json', cookie } })).json();
  await call('PUT', '/api/admin/lights', { mode: 'live' }, boss);
  const look = async (title, module) => (await call('POST', '/api/looks', { title, layers: [{ id: 'l1', title: 'All',
    modules: [{ id: 'a', kind: 'source', ...module }] }] })).look;
  // The lights play a library look; the editor's is custom code, black, then white.
  const playing = await look('On the lights', { title: 'Fire', ref: 'fire', code: pixel(0.3) });
  const edited = await look('Being edited', { title: 'Flat', code: pixel(0) });
  await expect.poll(async () => (await call('GET', '/api/lights')).engine).toBe(true);
  expect(await call('POST', '/api/lights/queue', { lookId: playing.id, at: 'now' })).toEqual({ kind: 'live' });
  const dir = process.env.RELAY_SHOTS;
  const shot = (page, name) => page.screenshot({ path: dir ? path.join(dir, `${name}.png`)
    : info.outputPath(`${name}.png`) });

  for (const size of ['laptop', 'phone']) {
    const ctx = await browser.newContext(SIZES[size]);
    const [name, value] = cara.split('=');
    await ctx.addCookies([{ name, value, url: origin }]);
    const page = await ctx.newPage(), errors = [];
    const debug = { sent: 0, received: 0, slots: [], states: [] };
    page.on('websocket', (ws) => {
      ws.on('framesent', ({ payload }) => {
        if (typeof payload === 'string') return;
        debug.sent++;
        debug.slots.push([Date.now(), payload.readUInt32LE(0)]);
        if (debug.slots.length > 20) debug.slots.shift();
      });
      ws.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string') return;
        const m = JSON.parse(payload);
        if (m.type !== 'state') return;
        debug.received++;
        debug.states.push([Date.now(), m.state.relay]);
        if (debug.states.length > 5) debug.states.shift();
      });
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${origin}/studio/${edited.id}`);
    await expect(page.locator('.viewer-msg').first()).toBeHidden({ timeout: 60_000 });
    // The transport keeps to the screen's width (the button's label shortens on a phone).
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(SIZES[size].viewport
      .width);
    await page.getByRole('button', { name: 'To the lights' }).click();
    const panel = page.getByRole('group', { name: 'To the lights' });
    await panel.getByRole('checkbox', { name: 'To the lights' }).check();
    await expect(panel.getByRole('status')).toContainText('Relaying', { timeout: 30_000 });
    // Over the look the lights play: the editor's black takes over from its fire, steady.
    await expect.poll(() => stats().relay?.on, { timeout: 15_000 }).toBe(true).catch((err) => {
      console.log('RELAY DEBUG', size, JSON.stringify(debug), JSON.stringify(stats()));
      throw err;
    });
    expect(stats().relay.by).toBe('cara');
    await expect.poll(() => stats().watts, { timeout: 10_000 }).toBeLessThan(5);
    const missed = stats().relay.missed;
    if (size === 'laptop') {
      // An unsaved edit: white, on the lights within a few stats lines (the buffer, then the meter's own smoothing).
      await page.locator('.dock-tab', { hasText: 'Code' }).click();
      await page.locator('textarea.code:visible').first().fill(pixel(1));
      await expect(page.locator('.studio.is-dirty')).toHaveCount(1);
      await expect.poll(() => stats().watts, { timeout: 10_000 }).toBeGreaterThan(50);
      await page.getByRole('button', { name: 'To the lights' }).click();
    }
    await page.waitForTimeout(3000);
    expect(stats().relay.on).toBe(true);
    expect(stats().relay.missed - missed, 'missed in 3 s').toBeLessThanOrEqual(4);
    await expect(panel.getByRole('status')).toContainText('ms ahead');
    await shot(page, `relay-studio-${size === 'laptop' ? 1366 : 390}`);
    await panel.getByRole('checkbox', { name: 'To the lights' }).uncheck();
    await expect.poll(() => stats().relay, { timeout: 5000 }).toBeNull();
    expect(errors).toEqual([]);
    await ctx.close();
  }
});
