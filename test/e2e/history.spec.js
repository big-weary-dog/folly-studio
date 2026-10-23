// npm run smoke, too: the History drawer at a laptop's and a phone's size. Steps: two edits are two steps, a click
// jumps back (the later ones grey), Ctrl+Shift+Z and Ctrl+Z walk them. Versions: a look saved three times lists its
// versions, previews one (the view says so, editing and saving wait), goes back to the work, restores one, saves a
// named version and names a past one. Ctrl+S saves a focused field's typing.
// With HISTORY_SHOTS set to a folder, each state's screenshot goes there.
import path from 'node:path';

import { expect, signup, test } from './studio.js';

const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const PIXEL = 'function pixel(p, t, P) { return [p.x, p.y, p.z]; }';
const layer = (level) => ({ id: 'l1', title: 'Glow', code: PIXEL, level, params: {} });
const palette = (body) => ({ low: ['#120a2a'], body: [body], accent: ['#ffb070'], high: ['#fff4e0'] });

/** A look of `cookie`'s, saved three times: versions 1 (red), 2 (green) and 3 (blue, as saved). */
async function savedThrice(origin, cookie) {
  const call = async (method, url, body) => (await fetch(`${origin}${url}`, { method, body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', cookie } })).json();
  const { look } = await call('POST', '/api/looks', { title: 'Embers', layers: [layer(1)],
    globals: { palette: palette('#c0281e') } });
  await call('PUT', `/api/looks/${look.id}`, { layers: [layer(0.6)], globals: { palette: palette('#2ec060') } });
  await call('PUT', `/api/looks/${look.id}`, { layers: [layer(0.8)], globals: { palette: palette('#3060f0') } });
  return look.id;
}

const shooter = (page, device, info) => (step) => page.screenshot({ timeout: 60_000,
  path: process.env.HISTORY_SHOTS ? path.join(process.env.HISTORY_SHOTS, `${device.viewport.width}-${step}.png`)
    : info.outputPath(`${step}.png`) });

for (const [name, device] of Object.entries(SIZES)) {
  test.describe(`${name}, ${device.viewport.width} × ${device.viewport.height}`, () => {
    test.use(device);

    test('History: each edit a step, a jump back, undo and redo', async ({ page, studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const shot = shooter(page, device, info);
      const cookie = await signup(studio.origin, `steps-${name}`), [k, v] = cookie.split('=');
      await page.context().addCookies([{ name: k, value: v, url: studio.origin }]);
      // Full detail, so a phone shows blend and level (the sandbox iframe has no storage)
      await page.addInitScript(() => { try { localStorage.setItem('studio.phoneDetail', '1'); } catch {} });
      await page.goto(`${studio.origin}/studio/${await savedThrice(studio.origin, cookie)}`);

      await page.getByRole('button', { name: 'History', exact: true }).click();
      const drawer = page.locator('.history-drawer'), steps = drawer.locator('.hstep');
      await expect(steps).toHaveCount(1, { timeout: 30_000 });
      if (name === 'phone') {
        await drawer.getByRole('button', { name: 'Close' }).click();
        await page.locator('.studio-tabs .tab[data-tab=layers]').click();
      }
      await page.getByLabel('Blend for Glow').selectOption('over');
      await page.getByLabel('Level for Glow').press('ArrowUp');
      if (name === 'phone') await page.getByRole('button', { name: 'History', exact: true }).click();
      await expect(steps.locator('.hstep-label')).toHaveText(['Opened the look', 'Blend over', 'Level 81%']);
      await expect(page.locator('.save-state')).not.toHaveText('Saved');
      await page.waitForTimeout(1500);   // the view's first frames
      await shot('steps');

      await steps.first().locator('.hstep-btn').click();
      await expect(drawer.locator('.hstep.is-ahead')).toHaveCount(2);
      await expect(page.locator('.save-state')).toHaveText('Saved');
      await expect(drawer.getByRole('status')).toContainText('You went back 2 steps');
      await shot('jumped-back');

      await page.keyboard.press('Control+Shift+z');
      await expect(drawer.locator('.hstep.is-ahead')).toHaveCount(1);
      await page.keyboard.press('Control+z');
      await expect(drawer.locator('.hstep.is-now .hstep-label')).toHaveText('Opened the look');
      expect(errors).toEqual([]);
    });

    test('History: versions listed, one previewed, back to the work, one restored', async ({ page, studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const shot = shooter(page, device, info);
      const cookie = await signup(studio.origin, `versions-${name}`), [k, v] = cookie.split('=');
      await page.context().addCookies([{ name: k, value: v, url: studio.origin }]);
      const id = await savedThrice(studio.origin, cookie);
      await page.goto(`${studio.origin}/studio/${id}`);

      await page.getByRole('button', { name: 'History', exact: true }).click();
      const drawer = page.locator('.history-drawer'), versions = drawer.locator('.version');
      await drawer.getByRole('button', { name: 'Versions' }).click();
      await expect(versions).toHaveCount(3, { timeout: 30_000 });
      await expect(versions.first()).toContainText('v3');
      await expect(versions.first().locator('.version-strip i')).toHaveCount(4);
      await page.waitForTimeout(1500);   // the view's first frames
      await shot('versions');

      await versions.filter({ hasText: 'v1' }).getByRole('button', { name: 'Preview' }).click();
      await expect(page.locator('.pane-viewer')).toHaveAttribute('data-previewing', /Previewing version 1/);
      await expect(drawer.getByText('Your work', { exact: true })).toBeVisible();
      await page.keyboard.press('Control+s');
      await expect(page.getByText('You are previewing a version: restore it')).toBeVisible();
      await shot('version-preview');

      await drawer.getByRole('button', { name: 'Back to my work' }).click();
      await expect(page.locator('.pane-viewer')).not.toHaveAttribute('data-previewing', /./);
      await expect(page.locator('.save-state')).toHaveText('Saved');

      await versions.filter({ hasText: 'v1' }).getByRole('button', { name: 'Preview' }).click();
      await drawer.getByRole('button', { name: 'Restore this version' }).click();
      await expect(versions).toHaveCount(4);
      await expect(versions.first()).toContainText('Restored version 1');
      await expect(page.locator('.save-state')).toHaveText('Saved');
      await expect(page.locator('.pane-viewer')).not.toHaveAttribute('data-previewing', /./);

      await drawer.getByRole('button', { name: 'Save a named version…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Save a named version' });
      await dialog.getByLabel('Name').fill('Before the drop rework');
      await shot('named-save');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(versions.first()).toContainText('Before the drop rework');
      await expect(versions.first().locator('.t-named')).toBeVisible();
      await versions.filter({ hasText: 'v2' }).getByRole('button', { name: 'Name version 2' }).click();
      await page.getByRole('dialog', { name: 'Name version 2' }).getByLabel('Name').fill('Green');
      await page.getByRole('dialog', { name: 'Name version 2' }).getByRole('button', { name: 'Name it' }).click();
      await expect(versions.filter({ hasText: 'v2' })).toContainText('Green');
      expect(errors).toEqual([]);
    });
  });
}

test('Ctrl+S saves what a focused field shows, before it is left', async ({ page, studio }) => {
  const cookie = await signup(studio.origin, 'ctrl-s'), [k, v] = cookie.split('=');
  await page.context().addCookies([{ name: k, value: v, url: studio.origin }]);
  const id = await savedThrice(studio.origin, cookie);
  await page.goto(`${studio.origin}/studio/${id}`);
  const level = page.getByRole('spinbutton', { name: 'Level for Glow' });
  await level.fill('23');
  const put = page.waitForRequest((r) => r.method() === 'PUT' && r.url().endsWith(`/api/looks/${id}`));
  await page.keyboard.press('Control+s');
  expect((await put).postDataJSON().layers[0].level).toBe(0.23);
  await expect(level).toBeFocused();
});

