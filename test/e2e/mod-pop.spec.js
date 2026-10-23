// npm run smoke: ∿'s popover fits a laptop's screen with no scrolling inside it, in every mode (LFO, a modulator or
// macro, and the modulator's own nested ∿), and stays on screen; on a phone it is a sheet. A speed's beat clock.
import { readFileSync } from 'node:fs';

import { expect, signup, test } from './studio.js';

const code = (name) => readFileSync(new URL(`../../public/patterns/${name}.js`, import.meta.url), 'utf8');
const look = { title: 'Breathing bars', duration: 16, bpm: 120, layers: [
  { title: 'Bars', modules: [{ id: 'm1', kind: 'source', ref: 'bars', code: code('bars'),
    params: { speed: { mod: 'global', name: 'breath', from: 0.2, to: 1.2 } } }] },
  { title: 'Clouds', modules: [{ id: 'm1', kind: 'source', ref: 'clouds', code: code('clouds'),
    params: { speed: { mod: 'beats', per: 0.1 }, cover: { mod: 'envelope', from: 0, to: 1 } } }] }],
  globals: { macros: { storm: { value: 1, min: 0, max: 2 }, gust: { value: 0.3, min: 0, max: 1 },
    breath: { value: 0.5, min: 0, max: 1, mod: { mod: 'lfo', shape: 'sine', rate: 0.25, unit: 'beats', center: 0.5,
      depth: 0.5, pace: 'storm' } },
    sway: { value: 0.5, min: 0, max: 1, mod: { mod: 'lfo', shape: 'tri', rate: 0.5, unit: 'hz', center: 0.5,
      depth: 0.3 } } } } };

async function open(page, studio, user) {
  const cookie = await signup(studio.origin, user);
  const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST', body: JSON.stringify(look),
    headers: { 'content-type': 'application/json', cookie } });
  expect(res.status).toBe(201);
  const { look: { id } } = await res.json();
  const [name, value] = cookie.split('=');
  await page.context().addCookies([{ name, value, url: studio.origin }]);
  await page.goto(`${studio.origin}/studio/${id}`);
  const phone = page.viewportSize().width < 900;
  if (phone) {
    await page.locator('.layer-name').first().click();
    return;
  }
  await page.locator(phone ? '.tab[data-tab=look]' : '.dock-tab[data-dock=look]').click({ timeout: 30_000 });
  await page.locator('.mod-card[data-name=breath] .mod-tag').first().click({ timeout: 30_000 });
}

/** The drawer shown fits the Studio's height with nothing to scroll, and the 3D view stays beside it. */
async function fits(page, info, shot, sheet = false) {
  const pop = page.locator('.drawer:last-child');
  await expect(pop).toBeVisible();
  await page.waitForTimeout(150);
  const m = await pop.evaluate((el) => {
    const body = el.querySelector('.drawer-body'), r = el.getBoundingClientRect();
    const view = document.querySelector('.pane-viewer').getBoundingClientRect();
    const under = document.querySelector('.app-header').getBoundingClientRect().bottom;
    return { under, top: r.top, bottom: r.bottom, left: r.left, right: r.right,
      scroll: body.scrollHeight - body.clientHeight,
      view: { left: view.left, right: view.right, width: view.width } };
  });
  await page.screenshot({ path: info.outputPath(`${shot}.png`) });
  const vp = page.viewportSize();
  expect(m.top).toBeGreaterThanOrEqual(0);
  expect(m.bottom).toBeLessThanOrEqual(vp.height + 1);
  expect(m.left).toBeGreaterThanOrEqual(0);
  expect(m.right).toBeLessThanOrEqual(vp.width);
  if (sheet) return;
  expect(m.top, 'under the header').toBeGreaterThanOrEqual(m.under - 1);
  expect(m.scroll, `${shot} scrolls`).toBeLessThanOrEqual(1);
  expect(m.view.width, 'the 3D view stays').toBeGreaterThan(300);
  expect(m.view.right, 'the 3D view sits beside the drawer').toBeLessThanOrEqual(m.left + 1);
}

async function modes(page, info, tag, sheet = false) {
  const kind = (name) => page.locator('.drawer:last-child .mod-kinds').last().getByRole('button', { name });
  await expect(page.locator('.drawer:last-child .drawer-title')).toHaveText(/Modulate Speed/);
  await fits(page, info, `${tag}-1-modulator`, sheet);
  await page.locator('.drawer:last-child .mod-edit .param-mod').click();      // the modulator's own ∿
  await fits(page, info, `${tag}-2-nested`, sheet);
  await page.keyboard.press('Escape');
  await kind('LFO', { exact: true }).click();
  await fits(page, info, `${tag}-3-lfo`, sheet);
  await page.locator('.drawer:last-child').getByRole('button', { name: /hold/ }).click();
  await fits(page, info, `${tag}-4-lfo-hold`, sheet);
  await page.locator('.drawer:last-child .beat-clock').click();               // the LFO's rate in Hz
  await fits(page, info, `${tag}-5-lfo-hz`, sheet);
  await kind('Macro').click();
  await page.locator('.drawer:last-child .mod-pick', { hasText: 'gust' }).click();
  await fits(page, info, `${tag}-6-fader`, sheet);
}

for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080]]) {
  test.describe(`at ${width}×${height}`, () => {
    test.use({ viewport: { width, height } });
    test('every mode fits with no scrolling', async ({ page, studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await open(page, studio, `pop-${width}`);
      await modes(page, info, `${width}`);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('the beat clock', () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test('a speed keeps time with the beat, or counts a second; an old clip fade shows with Off', async ({ page,
    studio }, info) => {
    await open(page, studio, 'pop-clock');
    await page.keyboard.press('Escape');
    await page.locator('.layer-name', { hasText: 'Clouds' }).click();
    const row = page.locator('.field.param', { hasText: 'Speed' }), clock = row.locator('.beat-clock');
    await expect(clock).toHaveAttribute('aria-pressed', 'true');
    await expect(row.locator('input.scrub')).toHaveValue('0.10/beat');
    await expect(row).toContainText('Speed (clouds a beat)');
    await page.screenshot({ path: info.outputPath('clock-on.png') });
    await clock.click();                                                       // off: 0.1 a beat at 120 is 0.2 a second
    await expect(clock).toHaveAttribute('aria-pressed', 'false');
    await expect(row.locator('input.scrub')).toHaveValue('0.20');
    await expect(row).toContainText('Speed (clouds a second)');
    await page.screenshot({ path: info.outputPath('clock-off.png') });
    await page.locator('.field.param', { hasText: 'Cover' }).locator('.param-mod').click();
    const pop = page.locator('.drawer:last-child');
    await expect(pop.locator('.mod-old')).toContainText('Clip fade (old)');
    await page.screenshot({ path: info.outputPath('clip-fade-old.png') });
    await pop.locator('.mod-old').getByRole('button', { name: 'Off' }).click();
    await expect(pop.locator('.mod-old')).toHaveCount(0);
    await expect(pop.locator('.mod-kinds').getByRole('button', { name: 'LFO' })).toBeVisible();
    await expect(pop.locator('.mod-kinds').getByRole('button')).toHaveText(['LFO', 'Macro', 'Off', 'Automate']);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('existing bindings play without modulation authoring', async ({ page, studio }) => {
    await open(page, studio, 'pop-phone');
    await expect(page.locator('.param-mod')).toHaveCount(0);
    await expect(page.locator('.param-chip').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Automate', exact: true })).toHaveCount(0);
  });
});
