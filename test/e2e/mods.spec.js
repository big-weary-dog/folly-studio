// npm run smoke, too: a look's modulators at a laptop's size. The dock is one height on every tab, at least 220px,
// the same after a reload, and the splitter's drag is kept; the Look tab has a card per modulator whose chips open
// the param's ∿ and whose name renames it everywhere; the timeline has a lane per modulator that folds as a group.
import { readFileSync } from 'node:fs';

import { expect, signup, test } from './studio.js';

test.use({ viewport: { width: 1366, height: 768 } });

const code = (name) => readFileSync(new URL(`../../public/patterns/${name}.js`, import.meta.url), 'utf8');
const look = { title: 'Breathing bars', duration: 16, bpm: 120, layers: [
  { title: 'Bars', modules: [{ id: 'm1', kind: 'source', ref: 'bars', code: code('bars'),
    params: { speed: { mod: 'global', name: 'breath', from: 0.2, to: 1.2 } } }] },
  { title: 'Clouds', modules: [{ id: 'm1', kind: 'source', ref: 'clouds', code: code('clouds'),
    params: { speed: { mod: 'global', name: 'breath', from: 0.1, to: 0.5 } } }] }],
  globals: { macros: { storm: { value: 1, min: 0, max: 2 }, breath: { value: 0.5, min: 0, max: 1,
    mod: { mod: 'lfo', shape: 'sine', rate: 0.25, unit: 'beats', center: 0.5, depth: 0.5, pace: 'storm' } } } } };

/** A new account with the look, signed in on the page: the look's id. */
async function open(page, studio, user) {
  const cookie = await signup(studio.origin, user);
  const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST', body: JSON.stringify(look),
    headers: { 'content-type': 'application/json', cookie } });
  expect(res.status).toBe(201);
  const { look: { id } } = await res.json();
  const [name, value] = cookie.split('=');
  await page.context().addCookies([{ name, value, url: studio.origin }]);
  await page.goto(`${studio.origin}/studio/${id}`);
}

test('modulators on the Look tab and the timeline; the dock keeps one height', async ({ page, studio }, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await open(page, studio, 'mods-laptop');

  const dock = page.locator('.pane-code'), height = async () => (await dock.boundingBox()).height;
  const lanes = page.locator('.tl-mod-row');
  await expect(lanes).toHaveCount(1, { timeout: 30_000 });
  const first = await height();
  expect(first).toBeGreaterThanOrEqual(220);
  await expect(page.locator('.tl-mod-row .tl-mod-said')).toHaveText('drives Bars, Clouds');
  await page.screenshot({ path: info.outputPath('1-timeline.png') });

  await page.getByRole('button', { name: 'Modulators' }).click();          // the group folds, and stays folded
  await expect(lanes).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.tl-mods-fold')).toHaveAttribute('aria-expanded', 'false', { timeout: 30_000 });
  expect(Math.abs(await height() - first)).toBeLessThan(2);                 // a reload: the same height
  await page.locator('.tl-mods-fold').click();

  await page.locator('.tl-mod-label').click();                              // the lane's head opens it on Look
  const card = page.locator('.mod-card[data-name=breath]');
  await expect(card).toBeVisible();
  expect(Math.abs(await height() - first)).toBeLessThan(2);                 // a tab switch: the same height
  await expect(card.locator('.mod-how')).toHaveText('sine 1 bar × storm');
  await expect(card.locator('.mod-tag')).toHaveText([/Bars › Speed/, /Clouds › Speed/]);
  await expect(page.locator('.macro .mod-tag')).toHaveText(['pace of breath']);
  await page.screenshot({ path: info.outputPath('2-look.png') });

  await card.locator('.mod-tag').nth(1).click();                            // a chip opens the param's ∿
  await expect(page.locator('.layer.selected .layer-name')).toHaveText('Clouds');
  await expect(page.locator('.drawer:last-child .drawer-title')).toHaveText(/Modulate Speed/);
  await page.keyboard.press('Escape');

  const rename = card.locator('input.macro-name');                          // renaming carries the bindings
  await rename.fill('sway');
  await rename.press('Enter');
  await expect(page.locator('.mod-card[data-name=sway] .mod-tag')).toHaveCount(2);
  await page.getByRole('button', { name: 'Timeline' }).click();
  await expect(page.locator('.tl-mod-row[data-name=sway]')).toHaveCount(1);

  const bar = page.locator('.splitter'), box = await bar.boundingBox();     // a drag is kept per browser
  await page.mouse.move(box.x + box.width / 2, box.y + 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 100, { steps: 4 });
  await page.mouse.up();
  const dragged = await height();
  expect(dragged).toBeGreaterThan(first + 80);
  await page.reload();
  await expect(lanes).toHaveCount(1, { timeout: 30_000 });
  expect(Math.abs(await height() - dragged)).toBeLessThan(2);
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('existing faders remain without Time or modulator authoring', async ({ page, studio }, info) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await open(page, studio, 'mods-phone');
    await expect(page.locator('.tab[data-tab=time],.tl')).toHaveCount(0);
    await page.locator('.tab[data-tab=look]').click();
    await expect(page.getByLabel('storm value')).toBeVisible();
    await expect(page.locator('.mod-card,.param-mod')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('4-phone-look.png') });
    expect(errors).toEqual([]);
  });
});
