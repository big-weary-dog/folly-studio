// Prototype shots (reports/composite-ux): one look, a composite of Clouds and Bars (with a Hue filter), a Twist under
// it and Sparkle on top, drawn as dev draws it and as each ?cux= direction does, open and shut, at a laptop's size
// (the side column) and a phone's. Screenshots in CUX_SHOTS, or the run's output folder.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, signup, test } from './studio.js';

const code = (name) => readFileSync(new URL(`../../public/patterns/${name}.js`, import.meta.url), 'utf8');
const lib = (id, kind, ref, params = {}, more = {}) => ({ id, kind, ref, title: '', code: code(ref), params, ...more });
const look = (attach) => ({ title: 'Twisted pair', chain: 2, duration: 30, layers: [{ id: 'l1', title: 'Twisted pair',
  modules: [{ id: 'c1', kind: 'composite', title: 'Clouds and bars', code: '', params: {}, layers: [
    { id: 's1', title: 'Clouds', modules: [lib('a1', 'source', 'clouds', { cover: 0.7 })] },
    { id: 's2', title: 'Bars', modules: [lib('b1', 'source', 'bars', { bars: 5 }),
      lib('b2', 'filter', 'hue-shift', { speed: 0.15 }, attach ? { on: 'b1' } : {})] }] },
  lib('w1', 'warp', 'twist', { swirl: 1.2 }), lib('t1', 'source', 'sparkle', { density: 0.3 })] }] });

async function open(page, studio, cux, phone) {
  const cookie = await signup(studio.origin, `cux-${cux || 'dev'}${phone ? 'p' : 'l'}${Date.now() % 1e6}`);
  const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST', body: JSON.stringify(look(cux === 'b')),
    headers: { 'content-type': 'application/json', cookie } });
  expect(res.status, await res.clone().text()).toBe(201);
  const { look: { id } } = await res.json();
  const [name, value] = cookie.split('=');
  await page.context().addCookies([{ name, value, url: studio.origin }]);
  await page.goto(`${studio.origin}/studio/${id}${cux ? `?cux=${cux}` : ''}`);
  if (phone) await page.locator('.studio-tabs .tab[data-tab=layers]').click({ timeout: 30_000 });
  else await expect(page.locator('.chain-row[data-kind=composite]')).toBeVisible({ timeout: 30_000 });
}

for (const [device, use] of [['laptop', { viewport: { width: 1366, height: 768 } }],
  ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  test.describe(device, () => {
    test.use(use);
    const phone = device === 'phone';
    for (const cux of ['', 'a', 'b', 'c']) {
      test(`composite look ${cux || 'dev'}`, async ({ page, studio }, info) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        const dir = process.env.CUX_SHOTS, file = (n) => (dir ? path.join(dir, `${cux || 'dev'}-${device}-${n}.png`)
          : info.outputPath(`${n}.png`));
        const shot = async (n) => {
          await page.waitForTimeout(1200);
          if (phone) return page.screenshot({ path: file(n) });
          const side = await page.locator(cux === 'c' ? '.pane-layers' : '.pane-params').boundingBox();
          const end = await page.locator('.pane-params').boundingBox();
          await page.screenshot({ path: file(n), clip: { x: side.x, y: side.y, width: end.width,
            height: Math.min(768 - side.y, (cux === 'c' ? 768 : 420)) } });
        };
        await open(page, studio, cux, phone);
        await expect(page.locator('.chain-row[data-status=pending]')).toHaveCount(0, { timeout: 30_000 });
        if (cux === 'c') {
          if (!phone) await page.locator('.layer:not(.c-sub) .layer-name').click();
          await shot('collapsed');
          await page.locator('.layer.c-sub .layer-name', { hasText: 'Bars' }).click();
          await expect(page.locator('.c-back')).toBeVisible();
          await shot('expanded');
        } else {
          if (phone) await page.locator('.layer-name').first().click();
          const comp = page.locator('.chain-row[data-kind=composite] > .chain-top');
          await comp.evaluate((e) => {
            e.scrollIntoView({ block: 'start' });
            let x = e.parentElement;
            while (x && !(x.scrollHeight > x.clientHeight && getComputedStyle(x).overflowY !== 'visible')) {
              x = x.parentElement;
            }
            if (x) x.scrollTop -= 40;
          });
          await shot('expanded');
          await comp.locator(cux ? '.chain-fold' : '.chain-name').click();
          await shot('collapsed');
        }
        expect(errors).toEqual([]);
      });
    }
  });
}
