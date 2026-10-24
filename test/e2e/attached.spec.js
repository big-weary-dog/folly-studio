// Attached modules in the Studio's chain (SPEC-library "Attached modules"), at a laptop's size and a phone's: a warp
// attached to one of two sources drawn one step in under it, detached with Alt+↓ (it then bends both) and attached
// again by its grip; a filter attached; the preview running them without an error. Screenshots in the run's output
// folder, or ATTACHED_SHOTS.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, signup, test } from './studio.js';

const code = (name) => readFileSync(new URL(`../../public/patterns/${name}.js`, import.meta.url), 'utf8');
const lib = (id, kind, ref, params = {}, more = {}) => ({ id, kind, ref, title: '', code: code(ref), params, ...more });
const look = (title, modules) => ({ title, chain: 2, duration: 30, layers: [{ id: 'l1', title, modules }] });

// Clouds, and bars twisted on their own.
const WARPED = look('Bars twisted', [lib('a1', 'source', 'clouds', { cover: 0.7 }),
  lib('b1', 'source', 'bars', { bars: 5 }), lib('w1', 'warp', 'twist', { swirl: 2 }, { on: 'b1' })]);
// Clouds recoloured on their own, under bars.
const TINTED = look('Clouds tinted', [lib('a1', 'source', 'clouds', { cover: 0.7 }),
  lib('h1', 'filter', 'hue-shift', { offset: 0.5 }, { on: 'a1' }), lib('b1', 'source', 'bars', { bars: 5 })]);

async function open(page, studio, body, phone) {
  const cookie = await signup(studio.origin, `attached-${phone ? 'p' : 'l'}${Date.now() % 1e6}`);
  const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', cookie } });
  expect(res.status, await res.clone().text()).toBe(201);
  const { look: { id } } = await res.json();
  const [name, value] = cookie.split('=');
  await page.context().addCookies([{ name, value, url: studio.origin }]);
  await page.goto(`${studio.origin}/studio/${id}`);
  if (phone) {
    await page.locator('.studio-tabs .tab[data-tab=layers]').click({ timeout: 30_000 });
    await page.locator('.layer-name').first().click();
    await page.locator('.phone-module-picker').click();
  }
  await expect(page.locator('.attach-list > .chain-row').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.chain-row[data-status=pending]')).toHaveCount(0, { timeout: 30_000 });
}
const row = (page, id) => page.locator(`.chain-row[data-module="${id}"]`);
const top = (page, id) => row(page, id).locator(':scope > .chain-top');
const noErrors = async (page) => expect(page.locator(
  '.chain-row:is([data-status=compile], [data-status=runtime], [data-status=hung])')).toHaveCount(0);

for (const [device, use] of [['laptop', { viewport: { width: 1366, height: 768 } }],
  ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  test.describe(device, () => {
    test.use(use);
    const phone = device === 'phone';
    test('a warp and a filter attached to one source each, detached and attached again', async ({ page, studio },
      info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const dir = process.env.ATTACHED_SHOTS, file = (name) => (dir ? path.join(dir, `${device}-${name}.png`)
        : info.outputPath(`${device}-${name}.png`));
      /** The window, the attached module picked and in sight (on a phone, its row under the preview). */
      const shot = async (name, id, picked = false) => {
        if (!picked) await top(page, id).locator('.chain-name').click();
        if (!phone) await page.locator('button', { hasText: /^Front$/ }).click();
        else await top(page, id).evaluate((e) => e.scrollIntoView({ block: 'end' }));
        await expect(page.locator('.viewer-msg').first()).toBeHidden({ timeout: 30_000 });
        await page.screenshot({ path: file(name) });
      };

      await open(page, studio, WARPED, phone);
      await expect(row(page, 'b1').locator('.attach-list > .chain-row[data-module=w1]')).toHaveCount(1);
      await noErrors(page);
      await shot('warp-attached', 'w1');

      // Alt+↓ takes the twist off bars, below them: it then bends both sources.
      await top(page, 'w1').locator('.chain-name').focus();
      await page.keyboard.press('Alt+ArrowDown');
      await expect(page.locator('.attach-list > .chain-row')).toHaveCount(0);
      await shot('warp-whole', 'w1', true);

      // Its grip, held over the foot of bars' row, attaches it again.
      const g = await top(page, 'w1').locator('.grip').boundingBox(), b = await top(page, 'b1').boundingBox();
      await page.mouse.move(g.x + g.width / 2, g.y + 6);
      await page.mouse.down();
      await page.mouse.move(g.x + g.width / 2, b.y + b.height - 3, { steps: 8 });
      await expect(page.locator('.attach-list > .chain-end[data-drop]')).toHaveCount(1);
      await page.mouse.up();
      await expect(row(page, 'b1').locator('.attach-list > .chain-row[data-module=w1]')).toHaveCount(1);
      await noErrors(page);

      await open(page, studio, TINTED, phone);
      await expect(row(page, 'a1').locator('.attach-list > .chain-row[data-module=h1]')).toHaveCount(1);
      await noErrors(page);
      await shot('filter-attached', 'h1');
      expect(errors).toEqual([]);
    });
  });
}
