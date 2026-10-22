// Composites in the Studio's chain (SPEC-library "Composites"), at a laptop's size and a phone's: each source in a
// composite a sub-layer of its own, drawn as its row with the sub-layer's blend, its filter attached under it; the
// composite renamed in place and in full, shut to one row that says what it holds; a source dragged in as a sub-layer
// of its own and out again (Alt+↓), sub-layers reordered by their sources' grips (and Alt+↓), where one plays in its
// source's settings; a sub-layer of two sources under a one-line head; the preview running them without an error.
// Screenshots in the run's output folder, or COMPOSITE_SHOTS.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, signup, test } from './studio.js';

const code = (name) => readFileSync(new URL(`../../public/patterns/${name}.js`, import.meta.url), 'utf8');
const lib = (id, kind, ref, params = {}, more = {}) => ({ id, kind, ref, title: '', code: code(ref), params, ...more });
const comp = (id, title, layers, more = {}) => ({ id, kind: 'composite', title, code: '', params: {}, layers,
  ...more });

// Clouds, and bars recoloured on their own, composited; one twist over both; sparkle on top, unbent.
const TWISTED = { title: 'Twisted pair', chain: 2, duration: 30, layers: [{ id: 'l1', title: 'Twisted pair', modules: [
  comp('c1', 'Clouds and bars', [
    { id: 's1', title: 'Clouds', modules: [lib('a1', 'source', 'clouds', { cover: 0.7 })] },
    { id: 's2', title: 'Bars', modules: [lib('b1', 'source', 'bars', { bars: 5 }),
      lib('b2', 'filter', 'hue-shift', { speed: 0.15 }, { on: 'b1' })] }]),
  lib('w1', 'warp', 'twist', { swirl: 1.2 }),
  lib('t1', 'source', 'sparkle', { density: 0.3 })] }] };
// A sub-layer of two sources on the arches, over clouds, turned together by one rotate.
const PARTS = { title: 'Parts, turned', chain: 2, duration: 30, layers: [{ id: 'l1', title: 'Parts, turned', modules: [
  comp('c1', 'Rose and arches', [
    { id: 's1', title: 'Rose', tags: ['rose'], modules: [lib('a1', 'source', 'clouds')] },
    { id: 's2', title: 'Arches', tags: ['arch'], blend: 'max', modules: [lib('b1', 'source', 'single-strand'),
      lib('b2', 'source', 'fire'), lib('b3', 'warp', 'mirror')] }]),
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
    while (x && !(['auto', 'scroll'].includes(getComputedStyle(x).overflowY) && x.scrollHeight > x.clientHeight)) {
      x = x.parentElement;
    }
    return { top: x ? x.getBoundingClientRect().top : -1e3 };
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
    test('a composite of sources: renamed, shut, a source dragged in and out, its sub-layers reordered', async ({ page,
      studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const dir = process.env.COMPOSITE_SHOTS, file = (name) => (dir ? path.join(dir, `${device}-${name}.png`)
        : info.outputPath(`${device}-${name}.png`));
      /** The composite's row at the top of the view (on a phone, under the settings' head), then the Settings pane. */
      const shot = async (name) => {
        await top(page, 'c1').evaluate((e) => e.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(300);
        if (phone) {
          const head = await page.locator('.phone-head').boundingBox(), row = await top(page, 'c1').boundingBox();
          expect(row.y).toBeGreaterThanOrEqual(head.y + head.height - 1);          // not under the sticky head
          return page.screenshot({ path: file(name) });
        }
        return page.locator('.pane-params').screenshot({ path: file(name) });
      };
      const inComp = (id) => row(page, 'c1').locator(`.composite-body .chain-row[data-module=${id}]`);
      const leads = () => row(page, 'c1').locator('.sub-layer > .chain-list > .chain-row')
        .evaluateAll((es) => es.map((e) => e.dataset.module));

      await open(page, studio, TWISTED, phone);
      await expect(page.locator('.sub-head')).toHaveCount(0);                    // each source is its sub-layer
      await expect(row(page, 'b1').locator('.attach-list > .chain-row[data-module=b2]')).toHaveCount(1);
      if (!phone) {
        const blend = top(page, 'b1').locator('.chain-select');
        await expect(blend).toHaveValue('');                                     // the sub-layer's default: Add
        await expect(blend.locator('option:checked')).toHaveText('Add');
        await blend.selectOption('max');
        await expect(blend).toHaveValue('max');
      }
      const name = top(page, 'c1').locator('.chain-rename');
      await name.fill('Clouds over the bars, twisted together');
      await expect(name).toHaveValue('Clouds over the bars, twisted together');
      expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1))
        .toBe(true);                                                             // in full, wrapped if need be
      await noErrors(page);
      await shot('expanded');

      await top(page, 'c1').locator('.chain-fold').click();                     // ▸ shuts it
      await expect(row(page, 'c1').locator('.composite-body')).toHaveCount(0);
      await expect(top(page, 'c1').locator('.chain-note')).toHaveText('2 sub-layers · 3 modules');
      await shot('collapsed');
      await top(page, 'c1').locator('.chain-fold').click();

      // Sparkle in between Clouds and Bars, a sub-layer of its own; then Alt+↓ until it is back out.
      await drag(page, top(page, 't1').locator('.grip'), top(page, 'a1'), async () => {
        await expect(page.locator('.chain-row[data-module=b1][data-drop]')).toHaveCount(1);
        if (!phone) await shot('drag-in');
      });
      await expect.poll(leads).toEqual(['a1', 't1', 'b1']);
      await top(page, 't1').locator('.chain-name').focus();
      for (let i = 0; i < 4 && await inComp('t1').count(); i++) {
        await page.keyboard.press('Alt+ArrowDown');
        await page.waitForTimeout(200);
      }
      await expect(inComp('t1')).toHaveCount(0);
      await expect.poll(leads).toEqual(['a1', 'b1']);

      // Bars above Clouds by its grip, then back with Alt+↓ on its name; its filter comes with it.
      await drag(page, top(page, 'b1').locator('.grip'), top(page, 'c1'), () => {});
      await expect.poll(leads).toEqual(['b1', 'a1']);
      await top(page, 'b1').locator('.chain-name').focus();
      await page.keyboard.press('Alt+ArrowDown');
      await expect.poll(leads).toEqual(['a1', 'b1']);
      await expect(row(page, 'b1').locator('.attach-list > .chain-row[data-module=b2]')).toHaveCount(1);

      await pick(page, 'b1');                                                    // where it plays, in its settings
      await expect(page.locator('.sub-plays .sub-where')).toHaveText('Whole layer');
      await noErrors(page);

      await open(page, studio, PARTS, phone);
      await expect(page.locator('.sub-head')).toHaveCount(1);                    // two sources: one head
      await expect(page.locator('.sub-head .sub-name')).toHaveValue('Arches');
      await expect(top(page, 'a1').locator('.chain-note')).toHaveText('Plays on #rose');
      await page.waitForTimeout(1500);
      await noErrors(page);
      await shot('multi');
      expect(errors).toEqual([]);
    });
  });
}
