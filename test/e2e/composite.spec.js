// Composites in the Studio's chain (SPEC-library "Composites"), at a laptop's size and a phone's: a composite's
// sub-layers nested under its row, shut to one row that says what it holds, its name in full, a module dragged into a
// sub-layer and out again (Alt+↓), sub-layers reordered by their heads' grips (and Alt+↑), and the preview running
// them without an error. Screenshots in the run's output folder, or COMPOSITE_SHOTS.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, signup, test } from './studio.js';

const code = (name) => readFileSync(new URL(`../../public/patterns/${name}.js`, import.meta.url), 'utf8');
const lib = (id, kind, ref, params = {}, more = {}) => ({ id, kind, ref, title: '', code: code(ref), params, ...more });
const comp = (id, title, layers, more = {}) => ({ id, kind: 'composite', title, code: '', params: {}, layers,
  ...more });

// Two sources, each with its own filter, composited; one twist over both; sparkle added on top, unbent.
const TWISTED = { title: 'Twisted pair', chain: 2, duration: 30, layers: [{ id: 'l1', title: 'Twisted pair', modules: [
  comp('c1', 'Clouds over the bars, twisted together', [
    { id: 's1', title: 'Clouds', modules: [lib('a1', 'source', 'clouds', { cover: 0.7 }),
      lib('a2', 'filter', 'hue-shift', { speed: 0.15 })] },
    { id: 's2', title: 'Bars', modules: [lib('b1', 'source', 'bars', { bars: 5 }),
      lib('b2', 'filter', 'edge-fade', { width: 0.5 })] }]),
  lib('w1', 'warp', 'twist', { swirl: 1.2 }),
  lib('t1', 'source', 'sparkle', { density: 0.3 })] }] };
// Sub-layers that play on parts of the rig, turned together by one rotate.
const PARTS = { title: 'Parts, turned', chain: 2, duration: 30, layers: [{ id: 'l1', title: 'Parts, turned', modules: [
  comp('c1', 'Rose and arches', [
    { id: 's1', title: 'Rose', tags: ['rose'], modules: [lib('a1', 'source', 'clouds')] },
    { id: 's2', title: 'Arches', tags: ['arch'], modules: [lib('b1', 'source', 'single-strand'),
      lib('b2', 'warp', 'mirror')] },
    { id: 's3', title: 'Spires', tags: ['spire'], blend: 'max', modules: [lib('d1', 'source', 'fire')] }]),
  lib('w1', 'warp', 'rotate', { spin: 0.1 })] }] };

async function open(page, studio, look, phone) {
  const cookie = await signup(studio.origin, `composite-${phone ? 'p' : 'l'}${Date.now() % 1e6}`);
  const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST', body: JSON.stringify(look),
    headers: { 'content-type': 'application/json', cookie } });
  expect(res.status, await res.clone().text()).toBe(201);
  const { look: { id } } = await res.json();
  const [name, value] = cookie.split('=');
  await page.context().addCookies([{ name, value, url: studio.origin }]);
  await page.goto(`${studio.origin}/studio/${id}`);
  if (phone) {
    await page.locator('.studio-tabs .tab[data-tab=layers]').click({ timeout: 30_000 });
    await page.locator('.layer-name').first().click();
  }
  await expect(page.locator('.chain-row[data-kind=composite]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.chain-row[data-status=pending]')).toHaveCount(0, { timeout: 30_000 });
}
const row = (page, id) => page.locator(`.chain-row[data-module="${id}"]`);
const top = (page, id) => row(page, id).locator(':scope > .chain-top');
const pick = (page, id) => top(page, id).locator('.chain-name').click();
const noErrors = async (page) => expect(page.locator(
  '.chain-row:is([data-status=compile], [data-status=runtime], [data-status=hung])')).toHaveCount(0);
/** Press the mouse on `grip`, move it to the foot of `target` above it, letting the pane scroll there by holding the
 * pointer at its top edge (a phone's is short), take the screenshot `shot`, let go. */
async function drag(page, grip, target, shot) {
  await grip.evaluate((e) => e.scrollIntoView({ block: 'end' }));
  const g = await grip.boundingBox(), x = g.x + g.width / 2, pane = await target.evaluate((e) => {
    let x = e;
    while (!(['auto', 'scroll'].includes(getComputedStyle(x).overflowY) && x.scrollHeight > x.clientHeight)) {
      x = x.parentElement;
    }
    return { top: x.getBoundingClientRect().top };
  });
  await page.mouse.move(x, g.y + 6);
  await page.mouse.down();
  for (let i = 0; i < 80; i++) {
    const t = await target.boundingBox(), y = t.y + t.height - 2;
    if (y > pane.top + 90) {
      await page.mouse.move(x, y, { steps: 6 });
      break;
    }
    await page.mouse.move(x, pane.top + 4 + (i % 2));
  }
  await shot();
  await page.mouse.up();
}

for (const [device, use] of [['laptop', { viewport: { width: 1366, height: 768 } }],
  ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  test.describe(device, () => {
    test.use(use);
    const phone = device === 'phone';
    test('a composite nested in the chain: shut, named, dragged into, its sub-layers reordered', async ({ page,
      studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const dir = process.env.COMPOSITE_SHOTS, file = (name) => (dir ? path.join(dir, `${device}-${name}.png`)
        : info.outputPath(`${device}-${name}.png`));
      const shot = (name) => (phone ? page.screenshot({ path: file(name) })
        : page.locator('.pane-params').screenshot({ path: file(name) }));

      await open(page, studio, TWISTED, phone);
      await pick(page, 'a2');                                     // a filter inside a sub-layer
      await page.waitForTimeout(1500);
      await noErrors(page);
      await shot('expanded');
      if (!phone) await page.screenshot({ path: file('expanded-window') });

      const name = top(page, 'c1').locator('.chain-name');
      await name.click();                                         // the composite's name shuts it
      await expect(row(page, 'c1').locator('.composite-body')).toHaveCount(0);
      await expect(name.locator('.chain-note')).toHaveText('2 sub-layers · 4 modules');
      await expect(name).toContainText('Clouds over the bars, twisted together');
      expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);    // in full, not cut off
      await shot('collapsed');
      await name.click();

      // Sparkle into the Bars sub-layer, after Edge fade, then Alt+↓ until it is back out on the layer's chain.
      await drag(page, top(page, 't1').locator('.grip'), top(page, 'b2'), () => shot('drag-in'));
      await expect(row(page, 'c1').locator('.chain-row[data-module=t1]')).toHaveCount(1);
      await top(page, 't1').locator('.chain-name').focus();
      for (let i = 0; i < 3 && await row(page, 'c1').locator('.chain-row[data-module=t1]').count(); i++) {
        await page.keyboard.press('Alt+ArrowDown');
        await page.waitForTimeout(200);
      }
      await expect(row(page, 'c1').locator('.chain-row[data-module=t1]')).toHaveCount(0);

      // Bars above Clouds by its head's grip, then back with Alt+↑ on its name.
      const subs = page.locator('.sub-layer > .sub-head .sub-name');
      await drag(page, page.locator('.sub-layer').nth(1).locator('.sub-head .grip'),
        page.locator('.sub-layer').first().locator('.sub-head .sub-badge'), async () => {
          await expect(page.locator('.sub-layer[data-drop]')).toHaveCount(1);       // the line where it lands
          await shot('reorder');
        });
      const names = () => subs.evaluateAll((es) => es.map((e) => e.value));
      await expect.poll(names).toEqual(['Bars', 'Clouds']);
      await subs.nth(1).focus();
      await page.keyboard.press('Alt+ArrowUp');
      await expect.poll(names).toEqual(['Clouds', 'Bars']);
      await noErrors(page);

      await open(page, studio, PARTS, phone);
      await pick(page, 'b1');
      await page.waitForTimeout(1500);
      await noErrors(page);
      expect(errors).toEqual([]);
    });
  });
}
