// npm run smoke: looks that loop with the timeline open, on classic scrollbars (headless Chromium hides them, and a
// scrollbar that comes and goes is what made the timeline and the 3D view jump at each wrap). The new look's wrap moves
// no box. A look with a module the Studio has no code for and one that throws as it plays: those two layers add
// nothing and say why on their cards; the rest keeps playing through every loop, lit, every box still.
import { readFileSync } from 'node:fs';

import { expect, signup, test } from './studio.js';

test.use({ viewport: { width: 1366, height: 768 }, launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'],
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });

const code = (name) => readFileSync(new URL(`../../public/patterns/${name}.js`, import.meta.url), 'utf8');
const WASH = code('colour-wash'), BARS = code('bars');
const source = (ref, src, params = {}) => ({ id: ref, kind: 'source', title: ref, ref, code: src, params });
const layer = (id, title, modules) => ({ id, title, tags: ['all'], blend: 'add', level: 1, modules });
const LOOK = {
  title: 'Loops with broken layers',
  duration: 2,
  layers: [
    layer('bed', 'Bed', [source('colour-wash', WASH, { speed: 0.5 })]),
    layer('gone', 'Gone', [source('no-such-source', '')]),
    layer('throws', 'Throws', [source('colour-wash', WASH.replace('function pixel() {',
      'function pixel() {\n  throw new Error(\'boom\');'))]),
    layer('bars', 'Bars', [source('bars', BARS)]),
  ],
};

/** Pixels of a PNG brighter than a dim grey, decoded on a blank page (the app's CSP refuses data: fetches). */
async function litPixels(blank, png) {
  return blank.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, img.width, img.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) n++;
    return n;
  }, png.toString('base64'));
}

/** Starts noting, every frame, the timeline's, the view pane's and the 3D view's boxes; boxes() reads what it saw. */
async function watchBoxes(page) {
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.boxes = new Set();
    const box = (sel) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? [r.x, r.y, r.width, r.height].map(Math.round).join(',') : '-';
    };
    const tick = () => {
      w.boxes.add(`timeline ${box('.tl-scroll')} | pane ${box('.pane-viewer')} | view ${box('canvas.viewer-canvas')}`);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () => page.evaluate(() => [.../** @type {any} */ (window).boxes]);
}

/** Opens the Timeline dock and plays. */
async function playWithTimeline(page) {
  await expect(page.locator('.tp-stats')).toHaveText(/\d+ fps/, { timeout: 30_000 });
  await page.locator('.dock-tab', { hasText: 'Timeline' }).click();
  await expect(page.locator('.tl-rows:visible').first()).toBeVisible();
  const play = page.locator('.tp-play').first();
  if (await play.getAttribute('aria-label') === 'Play') await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  return play;
}

test('the new look loops with the timeline open and nothing jumps', async ({ page, studio }) => {
  const { origin } = studio;
  const [name, value] = (await signup(origin, 'wrap')).split('=');
  await page.context().addCookies([{ name, value, url: origin }]);
  await page.goto(`${origin}/studio`);
  const bar = await page.evaluate(() => {
    const d = Object.assign(document.createElement('div'), { style: 'overflow: scroll; width: 100px' });
    document.body.append(d);
    const w = d.offsetWidth - d.clientWidth;
    d.remove();
    return w;
  });
  expect(bar, 'scrollbars take room here, as on a desktop').toBeGreaterThan(0);
  await playWithTimeline(page);
  const length = page.getByLabel('Length').first();
  await length.fill('2');
  await length.press('Enter');
  await page.waitForTimeout(500);
  const boxes = await watchBoxes(page);
  await page.waitForTimeout(5000);      // two wraps and more
  expect(await page.locator('.tp-time, .tp-clock').first().textContent()).toMatch(/\/ 0:02\.00/);
  expect(await boxes(), 'the timeline, the view pane and the 3D view hold still through the wraps').toHaveLength(1);
});

test('a looping look: broken layers say why, the rest plays on, nothing jumps', async ({ page, studio }, info) => {
  const { origin } = studio;
  const cookie = await signup(origin, 'looper');
  const [name, value] = cookie.split('=');
  await page.context().addCookies([{ name, value, url: origin }]);
  const res = await fetch(`${origin}/api/looks`, { method: 'POST', body: JSON.stringify(LOOK),
    headers: { cookie, 'content-type': 'application/json' } });
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  const { look } = await res.json();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${origin}/studio/${look.id}`);
  const play = await playWithTimeline(page);

  const card = (title) => page.locator('.layer', { has: page.locator('.layer-name', { hasText: title }) });
  await expect(card('Gone').locator('.layer-issue')).toHaveText(/^Compile error/, { timeout: 15_000 });
  await expect(card('Throws').locator('.layer-issue')).toHaveText(/^Runtime error: .*boom/, { timeout: 15_000 });
  await expect(card('Bars').locator('.layer-issue')).toHaveCount(0);

  const boxes = await watchBoxes(page);
  const blank = await page.context().newPage();
  const lit = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1000);
    lit.push(await litPixels(blank, await page.locator('canvas.viewer-canvas').screenshot()));
  }
  await blank.close();
  await page.screenshot({ path: info.outputPath('looping.png') });
  expect(await boxes(), 'the timeline, the view pane and the 3D view hold still through the loops').toHaveLength(1);
  expect(Math.min(...lit), `bright pixels each second: ${lit.join(', ')}`).toBeGreaterThan(2000);
  expect(await page.locator('.tp-time, .tp-clock').first().textContent()).toMatch(/\/ 0:02\.00/);
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  expect(errors.filter((e) => !/Failed to load resource: the server responded with a status of 40[14]/.test(e)),
    'console errors').toEqual([]);
});
