// npm run smoke, too: /live's jukebox on the Pi profile (SPEC-offline "The live page"), against the real engine in a
// dry run. A curator switches between the Folly, the track listing and the lights' controls: takes a look off the
// queue, skips, finds a Studio look to add, blacks out from the controls and from the Folly's bar. A member sees the
// stage alone. Screenshots of each view at a laptop's and a phone's size, in LIGHTS_SHOTS when it names a folder.
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
test.use({ serverOptions: { profile: 'pi', curators: 'cara', piPreview: `http://127.0.0.1:${port}` } });
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

test('a curator runs the jukebox from /live; a member watches', async ({ browser, studio }, info) => {
  const { origin } = studio;
  const cara = await signup(origin, 'cara'), bob = await signup(origin, 'bob');
  const call = async (method, url, body) => (await fetch(`${origin}${url}`, { method, body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', cookie: cara } })).json();
  const looks = [];
  for (const title of ['Ember choir', 'Slow fire', 'Night procession']) looks.push((await call('POST', '/api/looks',
    FIRE(title))).look);
  await expect.poll(async () => (await call('GET', '/api/lights')).engine).toBe(true);
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
    // Something playing from Studio, and three queued behind it.
    await emptyQueue();
    await call('POST', '/api/lights/queue', { lookId: looks[0].id, at: 'now' });
    for (const l of [looks[1], looks[2], looks[0]]) await call('POST', '/api/lights/queue', { lookId: l.id });
    const { page, errors } = await open(cara, size);
    const view = (name) => page.getByRole('group', { name: 'View' }).getByRole('button', { name, exact: true });

    await view('Tracks').click();
    await expect(page.locator('.jb-now h1')).toHaveText('Ember choir', { timeout: 10_000 });
    await expect(page.locator('.pi-queue li')).toHaveCount(3);
    await page.getByRole('button', { name: 'Take Night procession off' }).click();
    await expect(page.locator('.pi-queue li')).toHaveCount(2);
    await page.getByRole('searchbox', { name: 'Find a look in Studio' }).fill('night');
    await expect(page.locator('.jb-look')).toHaveCount(1);
    await page.locator('.jb-look').click();
    const dialog = page.getByRole('dialog', { name: 'Play on the lights' });
    await expect(dialog).toContainText('plays live');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('searchbox', { name: 'Find a look in Studio' }).fill('');
    await page.getByRole('searchbox', { name: 'Find a look in Studio' }).blur();
    await shot(page, `jukebox-tracks-${size}`);
    await view('Folly').click();
    await expect(page.locator('.live-viewer canvas')).toBeVisible();
    await expect(page.locator('.viewer-msg')).toBeHidden({ timeout: 60_000 });
    const bar = page.locator('.live-bar');
    await bar.getByRole('button', { name: 'Skip' }).click();
    await expect(bar.locator('.live-title')).toHaveText('Slow fire', { timeout: 10_000 });
    await expect(page.locator('.live-next')).toContainText('Ember choir');
    await shot(page, `jukebox-folly-${size}`);

    // One of the lights' own looks, with controls of its own.
    await view('Tracks').click();
    await page.getByRole('button', { name: 'Fire', exact: true }).click();
    await view('Controls').click();
    await expect(page.locator('.jb-now h1')).toHaveText('Fire', { timeout: 10_000 });
    const blackout = page.locator('.live-panel').getByRole('button', { name: /^Blackout/ });
    await blackout.click();
    await expect(blackout).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.live-panel').getByText('Master')).toBeVisible();
    await expect(page.locator('.live-panel').getByRole('heading', { name: 'This look' })).toBeVisible();
    await shot(page, `jukebox-controls-${size}`);
    await blackout.click();
    await expect(blackout).toHaveAttribute('aria-pressed', 'false');
    // The view picked is kept for this browser.
    await page.reload();
    await expect(view('Controls')).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
    await page.context().close();
  }

  const member = await open(bob, 'phone');
  await expect(member.page.locator('.live-bar')).toBeVisible();
  await expect(member.page.getByRole('group', { name: 'View' })).toHaveCount(0);
  expect(member.errors).toEqual([]);
});
