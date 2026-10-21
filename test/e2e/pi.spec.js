// npm run smoke, too: the Pi's control page (pi/page) on a phone, against the real engine in a dry run. A push on a
// look's fader, tap tempo and its nudge, blackout, a switch, a strobe the flash guard catches (down to the safe look)
// and the PIN. Screenshots of each in the output, and no errors in the console (a CSP refusal is one).
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
async function pi(...args) {
  const looks = mkdtempSync(path.join(os.tmpdir(), 'pi-looks-'));
  writeFileSync(path.join(looks, 'strobe.json'), JSON.stringify({ title: 'Strobe (too fast)', duration: 30,
    layers: [{ modules: [{ ref: 'strobe', params: { speed: 12 } }] }] }));
  const config = path.join(mkdtempSync(path.join(os.tmpdir(), 'pi-config-')), 'config.json');
  writeFileSync(config, '{}');
  const port = await freePort();
  const p = spawn(process.execPath, [MAIN, '--dry-run', '--mode', 'live', '--http', String(port), '--bind', '127.0.0.1',
    '--stats', '600', '--looks', looks, '--config', config, ...args], { env: tagged(), stdio: 'pipe' });
  procs.push(p);
  let out = '';
  await new Promise((resolve, reject) => {
    p.stdout.on('data', (d) => { out += d; if (out.includes('control page on')) resolve(); });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => reject(new Error(`the Pi exited ${code}: ${out}`)));
  });
  return `http://127.0.0.1:${port}`;
}
test.afterAll(() => { for (const p of procs) p.kill('SIGKILL'); });

async function phone(browser, origin) {
  const ctx = await browser.newContext(PHONE), page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(origin);
  return { ctx, page, errors };
}
/** Drags a fader to `frac` of its width. */
async function drag(page, name, frac) {
  const box = await page.getByRole('slider', { name }).boundingBox();
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * frac, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}

test('the control page drives the engine from a phone', async ({ browser }, info) => {
  const shot = (page, step, fullPage = false) => page.screenshot({ path: info.outputPath(`${step}.png`), fullPage });
  const { page, errors } = await phone(browser, await pi());
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Heartbeat plasma');
  await expect(page.getByText('Dry run: nothing is sent to the lights.')).toBeVisible();

  await drag(page, 'Drive', 0.75);
  // The value the Pi reports back (the fader shows its own only while dragged): 0.4 before, 0.75 of 0..1 now.
  await expect.poll(async () => Math.abs(Number(await page.getByRole('slider', { name: 'Drive' })
    .getAttribute('aria-valuenow')) - 0.75)).toBeLessThan(0.05);
  const tap = page.getByRole('button', { name: /Tap tempo/ });
  for (let i = 0; i < 4; i++) {
    await tap.dispatchEvent('pointerdown');
    if (i < 3) await page.waitForTimeout(500);
  }
  await expect.poll(async () => Number(/([\d.]+) BPM/.exec(await tap.textContent())[1])).toBeGreaterThan(110);
  expect(Number(/([\d.]+) BPM/.exec(await tap.textContent())[1])).toBeLessThan(130);
  // The tempo is tap tempo's alone (no fader), nudged a BPM at a time either side.
  await expect(page.getByRole('slider', { name: 'BPM' })).toHaveCount(0);
  const tapped = Number(/([\d.]+) BPM/.exec(await tap.textContent())[1]);
  await page.getByRole('button', { name: 'Faster by 1 BPM' }).click();
  await expect.poll(async () => Number(/([\d.]+) BPM/.exec(await tap.textContent())[1])).toBeCloseTo(tapped + 1, 0);
  // Pushed and tapped, the look plays on: nothing it offers trips the flash guard (pi/test/library.test.ts).
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Heartbeat plasma');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await shot(page, '01-playing');
  await shot(page, '02-playing-full', true);

  await page.getByRole('button', { name: 'Blackout' }).click();
  await expect(page.getByRole('button', { name: 'Blacked out · Undo' })).toHaveAttribute('aria-pressed', 'true');
  await shot(page, '03-blackout');
  await page.getByRole('button', { name: 'Blacked out · Undo' }).click();

  await page.getByRole('button', { name: 'Fire', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fire');
  await expect(page.getByRole('button', { name: 'Fire', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Strobe (too fast)', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The flash guard caught Strobe (too fast) flashing',
    { timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Safe: dim colour wash');
  await shot(page, '04-flash-tripped');
  await page.getByRole('button', { name: 'Beat bars', exact: true })
    .or(page.getByRole('button', { name: 'Bars on the beat', exact: true })).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('with a PIN set, the page asks for it before anything else', async ({ browser }, info) => {
  const shot = (page, step) => page.screenshot({ path: info.outputPath(`${step}.png`) });
  const { page, errors } = await phone(browser, await pi('--pin', '2468'));
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
