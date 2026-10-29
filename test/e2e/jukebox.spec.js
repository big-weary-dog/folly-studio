// npm run smoke, too: /live on the Pi profile for a curator, the live play page (SPEC-liveplay "The page") against the
// real engine in a dry run. In Jukebox: takes a look off the queue, finds a Studio look of their own and adds it,
// fades to the next. In Live Play: cues one of the lights' own looks, blacks out and back, and the Folly in 3D beside
// it. A member sees the stage alone. Screenshots of each at a laptop's and a phone's size, in LIGHTS_SHOTS when it
// names a folder.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import WebSocket from 'ws';

import { tagged } from './procs.mjs';
import { expect, signup, test } from './studio.js';

const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 }, colorScheme: 'dark' },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    colorScheme: 'dark' },
};
const MAIN = fileURLToPath(new URL('../../pi/main.ts', import.meta.url));
const PIXEL = 'function pixel(p, t, P) { return [p.x, p.y, p.z]; }';
const FIRE = (title) => ({ title, shared: true, layers: [{ id: 'l1', title: 'Fire', groups: ['cathedral'],
  modules: [{ id: 'a', kind: 'source', title: 'Fire', ref: 'fire', code: PIXEL }] }] });

const port = await new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
test.use({ serverOptions: { profile: 'pi', admins: 'boss', curators: 'cara', piPreview: `http://127.0.0.1:${port}` } });
let engine;
test.beforeAll(async () => {
  const config = path.join(mkdtempSync(path.join(os.tmpdir(), 'pi-config-')), 'config.json');
  writeFileSync(config, '{}');
  engine = spawn(process.execPath, [MAIN, '--dry-run', '--mode', 'live', '--base', '/pi', '--http', String(port),
    '--bind', '127.0.0.1', '--stats', '600', '--config', config], { env: tagged(), stdio: 'pipe' });
  let out = '';
  await new Promise((resolve, reject) => {
    engine.stdout.on('data', (d) => { out += d; if (out.includes('control page on')) resolve(); });
    engine.on('exit', (code) => reject(new Error(`the Pi exited ${code}: ${out}`)));
  });
});
test.afterAll(() => engine?.kill('SIGKILL'));

/** Empties the engine's queue, straight on its socket. */
async function emptyQueue() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/pi/ws`, { origin: `http://127.0.0.1:${port}` });
  const state = await new Promise((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello' })));
    ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.type === 'state') resolve(m.state); });
    ws.on('error', reject);
  });
  for (const q of state.queue) ws.send(JSON.stringify({ type: 'unqueue', key: q.key }));
  await new Promise((r) => { setTimeout(r, 100); });
  ws.close();
}

test('a curator runs the lights from /live in both modes; a member watches', async ({ browser, studio }, info) => {
  const { origin } = studio;
  const cara = await signup(origin, 'cara'), bob = await signup(origin, 'bob'), boss = await signup(origin, 'boss');
  const mode = (m) => fetch(`${origin}/api/admin/lights`, { method: 'PUT', body: JSON.stringify({ mode: m }),
    headers: { 'content-type': 'application/json', cookie: boss } });
  const call = async (method, url, body) => (await fetch(`${origin}${url}`, { method, body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', cookie: cara } })).json();
  const looks = [];
  for (const title of ['Ember choir', 'Slow fire', 'Night procession']) looks.push((await call('POST', '/api/looks',
    FIRE(title))).look);
  await expect.poll(async () => (await call('GET', '/api/lights')).engine).toBe(true);
  // Their gallery previews, for the preview a pick opens.
  await expect.poll(async () => (await call('GET', '/api/looks')).looks.filter((l) => l.preview).length,
    { timeout: 30_000 }).toBe(3);
  const dir = process.env.LIGHTS_SHOTS;
  const shot = (page, name) => page.screenshot({ path: dir ? path.join(dir, `${name}.png`)
    : info.outputPath(`${name}.png`) });
  const open = async (cookie, size) => {
    const ctx = await browser.newContext(SIZES[size]);
    const [name, value] = cookie.split('=');
    await ctx.addCookies([{ name, value, url: origin }]);
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${origin}/live`);
    return { page, errors };
  };

  for (const size of ['laptop', 'phone']) {
    // The lights' own look playing, three of Studio's queued behind it.
    await mode('jukebox');
    await emptyQueue();
    for (const l of looks) await call('POST', '/api/lights/queue', { lookId: l.id });
    const { page, errors } = await open(cara, size);
    const h1 = page.getByRole('heading', { level: 1 });
    const fits = () => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight);

    await expect(page.getByText('Jukebox', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('slider')).toHaveCount(0);
    await expect(page.locator('.lp-q')).toHaveCount(3);
    await page.getByRole('button', { name: 'Take Night procession off' }).click();
    await expect(page.locator('.lp-q')).toHaveCount(2);
    await page.getByRole('button', { name: /Add a look/ }).first().click();
    await page.getByRole('searchbox', { name: 'Find a look' }).fill('night');
    await expect(page.locator('.lp-tile')).toHaveCount(1);
    await page.locator('.lp-tile').click();
    const preview = page.getByRole('dialog', { name: 'Night procession' });
    await expect(preview).toContainText('plays live');
    await expect(preview.getByRole('img', { name: /gallery preview/ })).toBeVisible();
    await shot(page, `preview-${size}`);
    await preview.getByRole('button', { name: 'Add to the end' }).click();
    if (size === 'phone') await expect(h1).toBeVisible();
    await expect(page.locator('.lp-q')).toHaveCount(3);
    expect(await fits()).toBe(true);
    await shot(page, `jukebox-${size}`);
    await page.getByRole('button', { name: /Fade to next/ }).click();
    await expect(h1).toHaveText('Ember choir', { timeout: 10_000 });

    // Live Play: the page turns to the knobs as the mode changes.
    await mode('live');
    await expect(page.getByText('Live Play', { exact: true })).toBeVisible({ timeout: 10_000 });
    if (size === 'phone') await page.getByRole('button', { name: /^Up next/ }).click();
    await page.getByRole('button', { name: /Add a look/ }).first().click();
    // A pick previews it first: closing it changes nothing.
    await page.getByRole('searchbox', { name: 'Find a look' }).fill('Slow fire');
    await page.getByRole('button', { name: /^Slow fire/ }).click();
    const cue = page.getByRole('dialog', { name: 'Slow fire' });
    await expect(cue.getByRole('img', { name: /gallery preview/ })).toBeVisible();
    await shot(page, `preview-live-${size}`);
    await cue.getByRole('button', { name: 'Close' }).click();
    await expect(cue).toBeHidden();
    await page.getByRole('button', { name: 'The lights\' own' }).click();
    await page.getByRole('searchbox', { name: 'Find a look' }).fill('Fire');
    await page.getByRole('button', { name: /^Fire/ }).click();
    await page.getByRole('button', { name: 'Cue it' }).click();
    await page.getByRole('button', { name: /^Fade to Fire/ }).click();
    await expect(h1).toHaveText('Fire', { timeout: 10_000 });
    await expect(page.getByRole('slider', { name: 'Master' })).toBeVisible();
    await shot(page, `live-play-${size}`);
    const hold = async (name) => {
      const box = await page.getByRole('button', { name }).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(800);
      await page.mouse.up();
    };
    await hold(/Black out the lights/);
    await expect(page.getByRole('button', { name: /Bring the lights back/ })).toHaveAttribute('aria-pressed', 'true');
    await shot(page, `blackout-${size}`);
    await hold(/Bring the lights back/);
    await expect(page.getByRole('button', { name: /Black out the lights/ })).toHaveAttribute('aria-pressed', 'false');
    expect(await fits()).toBe(true);

    // The Folly in 3D: the laptop's right column, behind ☰ on a phone.
    if (size === 'phone') await page.getByRole('button', { name: 'The Folly in 3D' }).click();
    await expect(page.locator('.live-viewer canvas')).toBeVisible();
    await expect(page.locator('.viewer-msg')).toBeHidden({ timeout: 60_000 });
    await shot(page, `folly-${size}`);
    expect(errors).toEqual([]);
    await page.context().close();
  }

  const member = await open(bob, 'phone');
  await expect(member.page.locator('.live-bar')).toBeVisible();
  await expect(member.page.locator('.lp')).toHaveCount(0);
  expect(member.errors).toEqual([]);
});
