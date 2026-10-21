// Report-only visual experiment. Run with tools/rose-warps.config.js, never the full smoke project.
import { mkdir, writeFile } from 'node:fs/promises';

import { candidates, look, reportDir, sources, splitLook } from './rose-warps-cases.js';
import { expect, signup, test } from '../../test/e2e/studio.js';

test('rose structural warps: controlled Studio stills and motion frames', async ({ page, studio }) => {
  await mkdir(`${reportDir}/images`, { recursive: true });
  const cookie = await signup(studio.origin, 'rose-study'), [name, value] = cookie.split('=');
  await page.context().addCookies([{ name, value, url: studio.origin }]);
  await page.addInitScript(() => {
    localStorage.setItem('studio.tour.welcomed', '1');
    localStorage.setItem('studio.venue', '0');
    localStorage.setItem('studio.ghost', '0');
  });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  const captures = [];
  async function capture(source, warp, params, key, times = [2], custom = null) {
    const body = custom || look(source, warp, params);
    const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST', body: JSON.stringify(body),
      headers: { cookie, 'content-type': 'application/json' } });
    expect(res.status, await res.clone().text()).toBe(201);
    const { look: saved } = await res.json();
    await page.goto(`${studio.origin}/studio/${saved.id}`);
    await expect(page.locator('[data-view="rose"]:visible')).toBeVisible();
    await page.locator('[data-view="rose"]:visible').click();
    await expect(page.locator('.tp-play')).toHaveCount(1);
    if (await page.locator('.tp-play').getAttribute('aria-label') === 'Pause') await page.locator('.tp-play').click();
    // The same Playa exposure on every shot; cells show the window's actual pane shapes.
    const leds = page.locator('.leds-btn:visible');
    if (await leds.getAttribute('aria-pressed') === 'true') await leds.click();
    if (warp) await page.locator('.chain-name:visible', { hasText: warp }).click();
    for (const [f, time] of times.entries()) {
      await page.locator('.tp-scrub').fill(String(time));
      await expect(page.locator('.tp-time')).toContainText(`0:0${time.toFixed(2)}`);
      await page.waitForTimeout(700); // camera easing and the requested sandbox frame
      await expect(page.locator('.viewer-msg:visible')).toHaveCount(0);
      await expect(page.locator('.layer-issue')).toHaveCount(0);
      const file = `${key}${times.length > 1 ? `-f${f}` : ''}.png`;
      await page.screenshot({ path: `${reportDir}/images/${file}` });
      const box = await page.locator('canvas.viewer-canvas').boundingBox();
      captures.push({ file, source, warp, params, time, box });
    }
  }
  for (const source of sources) {
    await capture(source, null, {}, `baseline-${source}`);
    for (const c of candidates) {
      for (const [i, params] of c.settings.entries()) {
        await capture(source, c.name, params, `${c.name}-${source}-${i + 1}`);
      }
    }
  }
  for (const c of candidates) await capture('bars', c.name, c.motion, `${c.name}-motion`, [0, 0.5, 1, 1.5]);
  await capture('bars', null, {}, 'baseline-motion', [0, 0.5, 1, 1.5]);
  for (const [rule, size, pick, index] of [
    ['alternate', 1, 'even', 0], ['wedges', 4, 'even', 0],
    ['ring', 1, 'one', 0], ['checker', 2, 'even', 0],
  ]) await capture('bars+clouds', null, { rule, size, pick, index }, `subsets-${rule}`, [2],
    splitLook(rule, size, pick, index));
  await writeFile(`${reportDir}/captures.json`, JSON.stringify(captures, null, 2));
  expect(consoleErrors).toEqual([]);
});
