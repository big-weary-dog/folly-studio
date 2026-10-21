// npm run smoke, too: Play on the lights (SPEC-offline "Playing on the lights") on the Pi profile, against the real
// engine in a dry run. A curator queues a library look from its card, plays one now from the editor's Export menu,
// and sees a look with custom code refused, saying why; /pi/ lists the queue, /live/control shows it read only, /live
// says what is up next; an admin turns live library looks off. Screenshots at a laptop's and a phone's size, in
// LIGHTS_SHOTS when it names a folder.
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
const FIRE = (title) => ({ title, layers: [{ id: 'l1', title: 'Fire', groups: ['cathedral'],
  modules: [{ id: 'a', kind: 'source', title: 'Fire', ref: 'fire', code: PIXEL }] }] });

const port = await new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
test.use({ serverOptions: { profile: 'pi', admins: 'boss', curators: 'cara',
  piPreview: `http://127.0.0.1:${port}` } });
let engine;
test.beforeAll(async () => {
  const config = path.join(mkdtempSync(path.join(os.tmpdir(), 'pi-config-')), 'config.json');
  writeFileSync(config, '{}');
  engine = spawn(process.execPath, [MAIN, '--dry-run', '--base', '/pi', '--http', String(port), '--bind', '127.0.0.1',
    '--stats', '600', '--config', config], { env: tagged(), stdio: 'pipe' });
  let out = '';
  await new Promise((resolve, reject) => {
    engine.stdout.on('data', (d) => { out += d; if (out.includes('control page on')) resolve(); });
    engine.on('exit', (code) => reject(new Error(`the Pi exited ${code}: ${out}`)));
  });
});
test.afterAll(() => engine?.kill('SIGKILL'));

async function person(browser, origin, cookie, size, url) {
  const ctx = await browser.newContext(SIZES[size]);
  const [name, value] = cookie.split('=');
  await ctx.addCookies([{ name, value, url: origin }]);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${origin}${url}`);
  return { page, errors };
}

test('a curator plays looks on the lights; the queue shows everywhere', async ({ browser, studio }, info) => {
  const { origin } = studio;
  const cara = await signup(origin, 'cara'), boss = await signup(origin, 'boss');
  const call = async (method, url, body) => (await fetch(`${origin}${url}`, { method, body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', cookie: cara } })).json();
  const ember = (await call('POST', '/api/looks', FIRE('Ember choir'))).look;
  await call('POST', '/api/looks', FIRE('Slow fire'));
  await call('POST', '/api/looks', { title: 'Hand-made glow', layers: [{ id: 'l1', title: 'Glow', code: PIXEL }] });
  await expect.poll(async () => (await call('GET', '/api/lights')).engine).toBe(true);
  const dir = process.env.LIGHTS_SHOTS;
  const shot = (page, name) => page.screenshot({ path: dir ? path.join(dir, `${name}.png`)
    : info.outputPath(`${name}.png`) });

  for (const size of ['laptop', 'phone']) {
    const { page, errors } = await person(browser, origin, cara, size, '/looks');
    const card = (title) => page.locator('.card', { hasText: title });
    await card('Hand-made glow').getByRole('button', { name: 'Play on the lights' }).click();
    const dialog = page.getByRole('dialog', { name: 'Play on the lights' });
    await expect(dialog.getByRole('alert')).toContainText('Has custom code: bake it');
    await expect(dialog.getByRole('button', { name: 'Play now' })).toBeDisabled();
    await shot(page, `refused-${size}`);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await card(size === 'laptop' ? 'Slow fire' : 'Ember choir').getByRole('button', { name: 'Play on the lights' })
      .click();
    await expect(dialog).toContainText('plays live');
    await shot(page, `dialog-${size}`);
    await dialog.getByRole('button', { name: 'Add to queue' }).click();
    await expect(page.locator('.toast').last()).toContainText('is in the queue');
    expect(errors).toEqual([]);
  }

  // The editor: Export → Play on the lights → Play now.
  const editor = await person(browser, origin, cara, 'laptop', `/studio/${ember.id}`);
  await editor.page.getByRole('button', { name: 'Export' }).click();
  await editor.page.getByRole('menuitem', { name: 'Play on the lights…' }).click();
  await editor.page.getByRole('dialog').getByRole('button', { name: 'Play now' }).click();
  await expect(editor.page.locator('.toast').last()).toContainText('is playing on the lights');

  const pi = await person(browser, origin, cara, 'phone', '/pi/');
  await expect(pi.page.getByRole('heading', { level: 1 })).toHaveText('Ember choir', { timeout: 10_000 });
  await expect(pi.page.locator('.pi-queue li')).toHaveCount(2);
  await expect(pi.page.locator('.pi-queue')).toContainText('cara');
  await shot(pi.page, 'pi-queue-phone');

  for (const size of ['laptop', 'phone']) {
    const control = await person(browser, origin, cara, size, '/live/control');
    await expect(control.page.locator('.lc-queue li')).toHaveCount(2);
    await expect(control.page.locator('.lc-head h1')).toHaveText('Ember choir');
    await shot(control.page, `control-${size}`);
    const live = await person(browser, origin, cara, size, '/live');
    await expect(live.page.locator('.live-next')).toContainText('Up next:');
    await expect(live.page.locator('.viewer-msg')).toBeHidden({ timeout: 60_000 });
    await shot(live.page, `live-${size}`);
    expect([...control.errors, ...live.errors]).toEqual([]);
  }

  for (const size of ['laptop', 'phone']) {
    const admin = await person(browser, origin, boss, size, '/admin/light');
    const toggle = admin.page.getByRole('checkbox', { name: 'Live library looks on the lights' });
    // On by default; the laptop turns it off, and the phone finds it so.
    await expect(toggle).toBeChecked({ checked: size === 'laptop' });
    await toggle.scrollIntoViewIfNeeded();
    if (size === 'laptop') {
      await toggle.click();
      await expect(toggle).not.toBeChecked();
    }
    await shot(admin.page, `admin-${size}`);
  }
  const off = await call('GET', `/api/lights?lookId=${ember.id}`);
  expect(off.play.error).toMatch(/^Live looks are off/);
  expect(pi.errors).toEqual([]);
});
