// npm run smoke, too: the Pi's live play page (pi/page, SPEC-liveplay "The page") on a phone, against the real engine
// in a dry run. In Live Play a look's knob, tap tempo and its nudge, the hold to black out and back, a cued crossfade,
// a strobe the flash guard catches (down to the safe look) and a lost link; in Jukebox the queue alone; and the PIN.
// Screenshots of each in the output, and no errors in the console (a CSP refusal is one).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { tagged } from './procs.mjs';

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  colorScheme: 'dark' };
const MAIN = fileURLToPath(new URL('../../pi/main.ts', import.meta.url));
const procs = [];

/** A free port on 127.0.0.1. */
const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

/** `npm run pi -- --dry-run` with the page on a free port, a strobe among its looks; its origin once it serves. */
async function pi({ mode = 'live', args = [] } = {}) {
  const looks = mkdtempSync(path.join(os.tmpdir(), 'pi-looks-'));
  writeFileSync(path.join(looks, 'strobe.json'), JSON.stringify({ title: 'Strobe (too fast)', duration: 30,
    layers: [{ modules: [{ ref: 'strobe', params: { speed: 12 } }] }] }));
  const config = path.join(mkdtempSync(path.join(os.tmpdir(), 'pi-config-')), 'config.json');
  writeFileSync(config, '{}');
  const port = await freePort();
  const p = spawn(process.execPath, [MAIN, '--dry-run', '--mode', mode, '--http', String(port), '--bind', '127.0.0.1',
    '--stats', '600', '--looks', looks, '--config', config, ...args], { env: tagged(), stdio: 'pipe' });
  procs.push(p);
  let out = '';
  await new Promise((resolve, reject) => {
    p.stdout.on('data', (d) => { out += d; if (out.includes('control page on')) resolve(); });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => reject(new Error(`the Pi exited ${code}: ${out}`)));
  });
  return { origin: `http://127.0.0.1:${port}`, proc: p };
}
test.afterAll(() => { for (const p of procs) p.kill('SIGKILL'); });

async function phone(browser, origin, clock = false) {
  const ctx = await browser.newContext(PHONE), page = await ctx.newPage(), errors = [];
  if (clock) await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(origin);
  return { ctx, page, errors };
}
/** Drags a strip from its foot to `frac` of its height. */
async function drag(page, name, frac) {
  const box = await page.getByRole('slider', { name }).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * (1 - frac), { steps: 6 });
  await page.mouse.up();
}
/** Hold until the engine reports the changed blackout state, then release. */
async function hold(page, name) {
  const button = page.getByRole('button', { name }), pressed = await button.getAttribute('aria-pressed');
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await expect(page.locator('.lp-bo')).toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true');
  } finally { await page.mouse.up(); }
}
/** Up next, Add a look, the tile, its preview's Cue it: in Live Play, to its cue. */
async function pick(page, title) {
  await page.getByRole('button', { name: /^Up next/ }).click();
  await page.getByRole('button', { name: /Add a look/ }).click();
  await page.getByRole('searchbox', { name: 'Find a look' }).fill(title);
  await page.getByRole('button', { name: new RegExp(`^${title}`) }).click();
  await page.getByRole('dialog', { name: title }).getByRole('button', { name: 'Cue it' }).click();
}
const bpm = async (tap) => Number(/([\d.]+) BPM/.exec(await tap.textContent())[1]);

test('Live Play drives the engine from a phone', async ({ browser }, info) => {
  const shot = (page, step) => page.screenshot({ path: info.outputPath(`${step}.png`) });
  const pi_ = await pi(), { page, errors } = await phone(browser, pi_.origin, true);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Heartbeat plasma');
  await expect(page.getByText('Live Play', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Dry run' })).toBeVisible();
  const fits = () => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight);
  expect(await fits()).toBe(true);

  await drag(page, 'Drive', 0.75);
  // The value the Pi reports back once the finger's lingers out: 0.4 before, 0.75 of 0..1 now.
  await expect.poll(async () => Math.abs(Number(await page.getByRole('slider', { name: 'Drive' })
    .getAttribute('aria-valuenow')) - 0.75)).toBeLessThan(0.05);
  await expect(page.getByText(/You're driving/)).toBeVisible();
  const tap = page.getByRole('button', { name: /^Tap/ });
  // Tap uses the page's performance clock, not the engine's scheduling or Playwright's round-trip time.
  // Unequal intervals give 150, 133.3, then 120 BPM: seeing 120 acknowledges the fourth tap before nudging.
  await page.clock.pauseAt(new Date('2026-01-02T00:00:00Z'));
  const intervals = [400, 500, 600];
  for (let i = 0; i < 4; i++) {
    await tap.dispatchEvent('pointerdown');
    if (i < 3) await page.clock.runFor(intervals[i]);
  }
  await page.clock.resume();
  await expect.poll(() => bpm(tap)).toBe(120);
  await page.getByRole('button', { name: 'Faster by 1 BPM' }).click();
  await expect.poll(() => bpm(tap)).toBe(121);
  // Pushed and tapped, the look plays on: nothing it offers trips the flash guard (pi/test/library-controls.test.ts).
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Heartbeat plasma');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await shot(page, '01-playing');

  await hold(page, /Black out the lights/);
  await expect(page.getByRole('button', { name: /Bring the lights back/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Blacked out' })).toBeVisible();
  await expect(page.getByText('Playing unseen')).toBeVisible();
  await shot(page, '02-blackout');
  await hold(page, /Bring the lights back/);
  await expect(page.getByRole('button', { name: /Black out the lights/ })).toHaveAttribute('aria-pressed', 'false');

  await pick(page, 'Fire');
  await page.getByRole('button', { name: '1 s' }).click();
  await shot(page, '03-cue');
  await page.getByRole('button', { name: 'Fade to Fire · 1 s' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fire');

  await pick(page, 'Strobe');
  await page.getByRole('button', { name: /^Fade to Strobe/ }).click();
  await expect(page.getByRole('alert')).toContainText('The flash guard caught Strobe (too fast) flashing',
    { timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Safe: dim colour wash');
  await shot(page, '04-flash-tripped');
  await pick(page, 'Bars on the beat');
  await page.getByRole('button', { name: /^Fade to Bars/ }).click();
  await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 10_000 });
  expect(await fits()).toBe(true);

  // The link lost: the lights play on as they were, and nothing here claims to reach them.
  pi_.proc.kill('SIGKILL');
  await expect(page.getByRole('alert')).toContainText('Can\'t reach the lights');
  await expect(page.getByRole('status').filter({ hasText: 'Reconnecting' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Blackout can't reach the lights/ })).toBeDisabled();
  await shot(page, '05-lost');
  expect(errors.filter((e) => !/WebSocket|ERR_CONNECTION_REFUSED/.test(e))).toEqual([]);
});

test('the Jukebox is the queue alone', async ({ browser }, info) => {
  const shot = (page, step) => page.screenshot({ path: info.outputPath(`${step}.png`) });
  const { page, errors } = await phone(browser, (await pi({ mode: 'jukebox' })).origin);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Heartbeat plasma');
  await expect(page.getByText('Jukebox', { exact: true })).toBeVisible();
  // No knobs, no Master, no tempo and no Blackout.
  await expect(page.getByRole('slider')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Black out|^Tap/ })).toHaveCount(0);

  await page.getByRole('button', { name: /Add a look/ }).click();
  await page.getByRole('button', { name: /^Fire/ }).click();
  // Its preview: the lights' own have no gallery preview, so it says so.
  const preview = page.getByRole('dialog', { name: 'Fire' });
  await expect(preview).toContainText('the lights\' own looks have none');
  await shot(page, '07-jukebox-add');
  await preview.getByRole('button', { name: 'Close' }).click();
  await expect(preview).toBeHidden();
  await page.getByRole('button', { name: /^Fire/ }).click();
  await preview.getByRole('button', { name: 'Play next' }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByText(/^Up next · 1/)).toBeVisible();
  await expect(page.getByText('Then').locator('..')).toContainText('Fire');
  await shot(page, '08-jukebox');
  await page.getByRole('button', { name: /Fade to next/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fire', { timeout: 5000 });
  expect(errors).toEqual([]);
});

test('with a PIN set, the page asks for it before anything else', async ({ browser }, info) => {
  const shot = (page, step) => page.screenshot({ path: info.outputPath(`${step}.png`) });
  const { page, errors } = await phone(browser, (await pi({ args: ['--pin', '2468'] })).origin);
  const pin = page.getByLabel('PIN');
  await expect(pin).toBeVisible();
  await shot(page, '05-pin');
  await pin.fill('1111');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong PIN.');
  await shot(page, '06-pin-wrong');
  await pin.fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Heartbeat plasma');
  expect(errors).toEqual([]);
});
