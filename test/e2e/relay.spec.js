// Relay to the lights (SPEC-live "Relay to the lights") on the Pi profile, against the real engine in a dry run: a
// curator's /live renders a live library look and the engine plays its frames, steady (its stats line says the relay
// is on and missing next to nothing), then lets go. Screenshots at a laptop's and a phone's size, in RELAY_SHOTS when
// it names a folder.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { tagged } from './procs.mjs';
import { expect, signup, test } from './studio.js';

const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 }, colorScheme: 'dark' },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    colorScheme: 'dark' },
};
const MAIN = fileURLToPath(new URL('../../pi/main.ts', import.meta.url));
const PIXEL = 'function pixel(p, t, P) { return [p.x, p.y, p.z]; }';

const port = await new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
test.use({ serverOptions: { profile: 'pi', admins: 'boss', curators: 'cara',
  piPreview: `http://127.0.0.1:${port}` } });
let engine;
const lines = [];
test.beforeAll(async () => {
  const config = path.join(mkdtempSync(path.join(os.tmpdir(), 'pi-config-')), 'config.json');
  writeFileSync(config, '{}');
  engine = spawn(process.execPath, [MAIN, '--dry-run', '--base', '/pi', '--http', String(port), '--bind', '127.0.0.1',
    '--stats', '1', '--config', config], { env: tagged(), stdio: 'pipe' });
  let out = '';
  await new Promise((resolve, reject) => {
    engine.stdout.on('data', (d) => {
      out += d;
      lines.push(...String(d).split('\n').filter(Boolean));
      if (out.includes('control page on')) resolve();
    });
    engine.on('exit', (code) => reject(new Error(`the Pi exited ${code}: ${out}`)));
  });
});
test.afterAll(() => engine?.kill('SIGKILL'));

/** The relay part of the engine's latest stats line: `{ by, on, missed }`, or null. */
const relayed = () => {
  const m = lines.findLast((l) => l.includes(' fps,'))?.match(/relay (\S+) (on|off), ahead \d+, missed (\d+)/);
  return m ? { by: m[1], on: m[2] === 'on', missed: Number(m[3]) } : null;
};

test('a curator relays a live look to the lights, steady, and lets go', async ({ browser, studio }, info) => {
  const { origin } = studio;
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
