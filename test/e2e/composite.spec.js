// Composites in the Studio, for the proposal (reports/composite): example looks at a laptop's size, the chain shown
// three ways (?cux=a nested, b opened on its own, c tabs), a drag into a sub-layer and out again, and the preview
// running them without an error. Screenshots in the run's output folder.
import { readFileSync } from 'node:fs';

import { expect, signup, test } from './studio.js';

test.use({ viewport: { width: 1366, height: 768 } });

const code = (name) => readFileSync(new URL(`../../public/patterns/${name}.js`, import.meta.url), 'utf8');
const lib = (id, kind, ref, params = {}, more = {}) => ({ id, kind, ref, title: '', code: code(ref), params, ...more });
const comp = (id, title, layers, more = {}) => ({ id, kind: 'composite', title, code: '', params: {}, layers,
  ...more });

// Two sources, each with its own filter, composited; one twist over both; sparkle added on top, unbent.
const TWISTED = { title: 'Twisted pair', chain: 2, duration: 30, layers: [{ id: 'l1', title: 'Twisted pair', modules: [
  comp('c1', 'Clouds and bars', [
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

let cookie = '';
async function open(page, studio, look, cux = 'a') {
  cookie ||= await signup(studio.origin, 'composite');
  const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST', body: JSON.stringify(look),
    headers: { 'content-type': 'application/json', cookie } });
  expect(res.status, await res.clone().text()).toBe(201);
  const { look: { id } } = await res.json();
  const [name, value] = cookie.split('=');
  await page.context().addCookies([{ name, value, url: studio.origin }]);
  await page.goto(`${studio.origin}/studio/${id}?cux=${cux}`);
  await expect(page.locator('.chain-row[data-kind=composite]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.chain-row[data-status=pending]')).toHaveCount(0, { timeout: 30_000 });
}
const row = (page, id) => page.locator(`.chain-row[data-module="${id}"]`);
const pick = (page, id) => row(page, id).locator(':scope > .chain-top .chain-name').click();
const noErrors = async (page) => expect(page.locator(
  '.chain-row:is([data-status=compile], [data-status=runtime], [data-status=hung])')).toHaveCount(0);

test('composites shown three ways; a drag in and out', async ({ page, studio }, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const shot = (name) => page.screenshot({ path: info.outputPath(`${name}.png`) });

  await open(page, studio, TWISTED);
  await pick(page, 'a2');                                         // a filter inside a sub-layer: its settings open
  await page.waitForTimeout(1500);
  await noErrors(page);
  await shot('a-nested');
  await page.locator('.pane-params').screenshot({ path: info.outputPath('a-nested-pane.png') });

  await pick(page, 'c1');                                         // the composite's name shuts it
  await expect(row(page, 'c1').locator('.composite-body')).toHaveCount(0);
  await page.locator('.pane-params').screenshot({ path: info.outputPath('a-collapsed-pane.png') });
  await pick(page, 'c1');

  // Drag Sparkle into the Bars sub-layer, after Bars, then Alt+↑ until it is back out on the layer's chain.
  const grip = row(page, 't1').locator(':scope > .chain-top .grip'), to = row(page, 'b2');
  const g = await grip.boundingBox(), b = await to.locator(':scope > .chain-top').boundingBox();
  await page.mouse.move(g.x + 4, g.y + 6);
  await page.mouse.down();
  await page.mouse.move(g.x + 4, b.y + b.height - 2, { steps: 8 });
  await page.locator('.pane-params').screenshot({ path: info.outputPath('a-drag-pane.png') });
  await page.mouse.up();
  await expect(row(page, 'c1').locator('.chain-row[data-module=t1]')).toHaveCount(1);
  await page.waitForTimeout(800);
  await shot('a-dropped');
  await row(page, 't1').locator(':scope > .chain-top .chain-name').focus();
  for (let i = 0; i < 3 && await row(page, 'c1').locator('.chain-row[data-module=t1]').count(); i++) {
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForTimeout(200);
  }
  await expect(row(page, 'c1').locator('.chain-row[data-module=t1]')).toHaveCount(0);

  await open(page, studio, TWISTED, 'b');
  await page.locator('.pane-params').screenshot({ path: info.outputPath('b-chain-pane.png') });
  await pick(page, 'c1');                                         // opens it on its own
  await expect(page.locator('.chain-crumbs')).toBeVisible();
  await pick(page, 'b1');
  await page.locator('.pane-params').screenshot({ path: info.outputPath('b-opened-pane.png') });
  await shot('b-opened');

  await open(page, studio, TWISTED, 'c');
  await page.locator('.sub-tab', { hasText: 'Bars' }).click();
  await pick(page, 'b2');
  await page.locator('.pane-params').screenshot({ path: info.outputPath('c-tabs-pane.png') });
  await shot('c-tabs');

  await open(page, studio, PARTS);
  await pick(page, 'b1');
  await page.waitForTimeout(1500);
  await noErrors(page);
  await shot('parts');
  expect(errors).toEqual([]);
});
