// npm run smoke, too: the Look panel at a laptop's and a phone's size. A fresh look has no Energy; a look from before
// the globals went (energy, speed, level, hue, saturation) opens with Energy as a fader of its own and nothing else
// of those.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, signup, test } from './studio.js';

const code = (name) => readFileSync(new URL(`../../public/patterns/${name}.js`, import.meta.url), 'utf8');
const clouds = { title: 'Clouds', modules: [{ id: 'm1', kind: 'source', ref: 'clouds', code: code('clouds'),
  params: { speed: { mod: 'global', name: 'energy', from: 0.1, to: 0.6 } } }] };
const LOOKS = {
  fresh: { title: 'Fresh', layers: [{ ...clouds, modules: [{ ...clouds.modules[0], params: {} }] }] },
  energy: { title: 'Old storm', layers: [clouds],
    globals: { energy: 0.7, speed: 1.5, level: 0.8, hue: 0.1, saturation: 1.2, palette: 'ember' } },
};

for (const width of [1366, 1920]) {
  test(`automation endpoints and creation (${width})`, async ({ page, studio }, info) => {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
    const cookie = await signup(studio.origin, `automation-${width}`), [name, value] = cookie.split('=');
    await page.context().addCookies([{ name, value, url: studio.origin }]);
    const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST',
      headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ ...LOOKS.fresh,
        globals: { macros: { energy: { value: 0.5, min: -2, max: 2 }, storm: { value: 0.3 } } },
        automation: { energy: [[2, -2], [4, -2], [6, 0], [8, 2], [10, 2]] } }) });
    expect(res.status).toBe(201);
    await page.goto(`${studio.origin}/studio/${(await res.json()).look.id}`);
    await page.locator('.dock-tab', { hasText: 'Timeline' }).click({ timeout: 30_000 });
    const lane = page.locator('.tl-auto-svg').first();
    await expect(lane).toBeVisible();
    const shot = (label) => page.screenshot({ path: process.env.AUTO_SHOTS
      ? path.join(process.env.AUTO_SHOTS, `${width}-after-${label}.png`)
      : info.outputPath(`${width}-${label}.png`) });
    await shot('lane');
    await expect(lane.locator('.tl-auto-dot[data-level=low]')).toHaveCount(2);
    await expect(lane.locator('.tl-auto-dot[data-level=high]')).toHaveCount(2);
    const colours = await lane.locator('.tl-auto-dot').evaluateAll((dots) => dots.map((dot) => ({
      stroke: getComputedStyle(dot).stroke, fill: getComputedStyle(dot).fill })));
    expect(colours[0].stroke).not.toBe(colours[2].stroke);
    expect(colours[3].stroke).not.toBe(colours[2].stroke);
    expect(colours[0].fill).not.toBe(colours[0].stroke);
    expect(colours[3].fill).toBe(colours[3].stroke);
    await expect(lane.locator('.tl-auto-half')).toHaveCount(1);
    const end = await lane.locator('.tl-auto-dot').last().boundingBox();     // a point's time and value on hover
    await page.mouse.move(end.x + 2, end.y + end.height / 2);
    await expect(lane.locator('.tl-auto-val').last()).toHaveText('0:10 · 2');
    if (width === 1366 && process.env.AUTO_FINAL_SHOTS) {
      await page.screenshot({ path: path.join(process.env.AUTO_FINAL_SHOTS, 'lane-normal-1366.png') });
    }
    await page.getByRole('combobox', { name: 'Automate a macro' }).selectOption('storm');
    await expect(page.locator('.tl-auto-row[data-name=storm]')).toBeVisible();
    await shot('created');
  });
}

for (const [size, viewport] of [['laptop', { width: 1366, height: 768 }], ['phone', { width: 390, height: 844 }]]) {
  test.describe(size, () => {
    test.use({ viewport });
    test(`the Look panel: Energy only on a look that uses it (${size})`, async ({ page, studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const cookie = await signup(studio.origin, `energy-${size}`);
      const [name, value] = cookie.split('=');
      await page.context().addCookies([{ name, value, url: studio.origin }]);
      for (const [which, look] of Object.entries(LOOKS)) {
        const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST', body: JSON.stringify(look),
          headers: { 'content-type': 'application/json', cookie } });
        expect(res.status).toBe(201);
        await page.goto(`${studio.origin}/studio/${(await res.json()).look.id}`);
        if (size === 'laptop') await page.locator('.dock-tab', { hasText: 'Look' }).click({ timeout: 30_000 });
        else await page.locator('.tab[data-tab=look]').click({ timeout: 30_000 });
        const panel = page.locator('.look-globals:visible');
        await expect(panel).toBeVisible({ timeout: 30_000 });
        const names = panel.locator(size === 'phone' ? '.macro > label' : 'input.macro-name');
        if (which === 'fresh') await expect(names).toHaveCount(0);
        else {
          await expect(names).toHaveCount(1);
          if (size === 'phone') await expect(names).toHaveText('energy');
          else await expect(names).toHaveValue('energy');
        }
        for (const gone of ['Speed', 'Level', 'Hue', 'Saturation']) {
          await expect(panel.getByText(gone, { exact: true })).toHaveCount(0);
        }
        await panel.screenshot({ path: info.outputPath(`${size}-${which}.png`) });
      }
      expect(errors).toEqual([]);
    });
  });
}

test('create automation from a setting and from the timeline picker', async ({ page, studio }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const cookie = await signup(studio.origin, 'automation-actions'), [name, value] = cookie.split('=');
  await page.context().addCookies([{ name, value, url: studio.origin }]);
  const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST',
    headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ ...LOOKS.fresh,
      globals: { macros: { energy: { value: 0.5 }, storm: { value: 0.3 } } },
      automation: { energy: [[0, 0], [10, 0.5], [20, 1]] } }) });
  expect(res.status).toBe(201);
  await page.goto(`${studio.origin}/studio/${(await res.json()).look.id}`);
  const shot = (name) => page.screenshot({ path: process.env.AUTO_ACTION_SHOTS
    ? path.join(process.env.AUTO_ACTION_SHOTS, `${name}-1366.png`) : info.outputPath(`${name}.png`) });
  await page.locator('[data-tour="param:speed"] .param-mod').click({ timeout: 30_000 });
  const action = page.locator('.mod-drawer .mod-kinds button').filter({ hasText: /^Automate$/ });
  await expect(action).toBeVisible();
  if (process.env.AUTO_ACTION_SHOTS) {
    await action.evaluate((el) => { el.style.display = 'none'; });
    await shot('setting-before');
    await action.evaluate((el) => { el.style.display = ''; });
    await shot('setting-choice-after');
  }
  await action.click();
  const settingLane = page.locator('.tl-auto-row[data-name=cloudsSpeed]');
  await expect(settingLane).toBeVisible();
  await expect(page.locator('[data-tour="param:speed"] .param-chip')).toContainText('cloudsSpeed');
  await page.keyboard.press('Control+z');
  await expect(settingLane).toHaveCount(0);
  await expect(page.locator('[data-tour="param:speed"] .param-chip')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(settingLane).toBeVisible();
  await shot('setting-created-after');   // the drawer's closing resize has settled through Undo/Redo
  const picker = page.locator('select.tl-auto-add');
  if (process.env.AUTO_ACTION_SHOTS) {
    await picker.evaluate((el) => {
      el.size = 3;
      Object.assign(el.style, { height: '90px', width: '210px', position: 'absolute', zIndex: '10' });
    });
    await picker.locator('option[value=":new"]').evaluate((el) => { el.hidden = true; });
    await shot('picker-before');
    await picker.locator('option[value=":new"]').evaluate((el) => { el.hidden = false; });
    await shot('picker-choice-after');
    await picker.evaluate((el) => { el.size = 0; el.removeAttribute('style'); });
  }
  await picker.selectOption(':new');
  await expect(page.locator('.tl-auto-row[data-name=automation]')).toBeVisible();
  await shot('picker-created-after');
});
