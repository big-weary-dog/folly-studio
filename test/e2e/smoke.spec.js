// npm run smoke: the app in a browser, the way a person meets it, at a laptop's size and a phone's: sign up, an idea
// the stand-in codex CLI turns into a look, the Studio in the Playa view with the sandbox running, a layer's Groups
// drawer's ticks (a group with all under it, none at all), a param dragged and stepped, a typo and a hang in the code
// (reported, paused by the watchdog, running again once fixed), the timeline, a source's Colours played in an accent
// and custom colours added to 4 and one removed (the pick tile), a param's help, a preset added from Add a layer on
// the groups picked there and one kind of module shown in Add a module, added and moved by Alt+↑ with its Combine in
// its row, its settings under it closed and opened by a click, and a bake in the real render box in Check & bake (the
// laptop opens it from Export and bakes; the phone, from its Look tab, says to bake from a larger screen and plays the
// baked frames).
// The real server and a fresh build (studio.js); WebGL on SwiftShader. Every request stays on our origin, and the
// console stays free of errors and CSP reports. Screenshots of each step land in the test's output folder.
import { createRenderBox } from '../../src/render-box.ts';
import { expect, quiet, test } from './studio.js';

const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const IDEA = 'Rising embers drift up the spires while the rose window glows';
const HANG = 'function pixel(p, t) {\n  while (true) {}\n}\n';
const BAKE = /^(?:Save & bake|Bake|Bake again)$/;
// Admins: exempt from invite codes and limits.
test.use({ serverOptions: { admins: 'smoke-laptop,smoke-phone' } });

for (const [name, device] of Object.entries(SIZES)) {
  test.describe(`${name}, ${device.viewport.width} × ${device.viewport.height}`, () => {
    test.use(device);

    test('sign up → idea → Studio (Playa) → code error → timeline → bake', async ({ page, studio }, info) => {
      const { origin } = studio;
      const wide = name === 'laptop';
      const shots = [];
      const shot = async (step) => {
        const file = info.outputPath(`${shots.length + 1}-${step}.png`);
        await page.screenshot({ path: file, timeout: 60_000 });
        shots.push(file);
        await info.attach(step, { path: file, contentType: 'image/png' });
      };
      const external = [], errors = [];
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(origin) || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
        external.push(url);
        return route.abort();
      });
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      // A tab on the phone (the code editor from More), a panel of the dock on the laptop.
      const open = async (tab, dock) => {
        if (wide) return page.locator('.dock-tab', { hasText: dock }).click();
        if (tab !== 'code') return page.locator(`.tab[data-tab=${tab}]`).click();
        await page.locator('.tab[data-tab=more]').click();
        await page.getByRole('button', { name: 'Open the code editor' }).click();
      };

      await test.step('sign up', async () => {
        await page.goto(`${origin}/`);
        await page.getByRole('button', { name: 'Sign up' }).click();
        await page.fill('input[name=username]', `smoke-${name}`);
        await page.fill('input[name=password]', 'correct horse');
        await page.locator('form button[type=submit]').click();
        await expect(page.locator('textarea.idea-input')).toBeVisible({ timeout: 20_000 });
      });

      await test.step('an idea becomes a look', async () => {
        await page.fill('textarea.idea-input', IDEA);
        await page.getByRole('button', { name: 'Turn it into a look' }).click();
        const studioLink = page.getByRole('link', { name: 'Open in Studio' }).first();
        await expect(studioLink).toBeVisible({ timeout: 60_000 });
        await studioLink.click();
        await expect(page).toHaveURL(/\/studio\/[\w-]+$/);
      });

      await test.step('the Studio, in the Playa view, with the sandbox running', async () => {
        await expect(page.locator('iframe.sandbox-frame')).toHaveAttribute('src', /^\/assets\/sandbox-[\w-]+\.html$/);
        await expect(page.locator('.view-modes .leds-btn').first())
          .toHaveAttribute('aria-pressed', 'false', { timeout: 30_000 });
        await expect(page.locator('.tp-stats')).toHaveText(/\d+ fps/, { timeout: 30_000 });
        const canvas = await page.locator('canvas:visible').first().evaluate((c) => [c.width, c.height]);
        expect(canvas.every((n) => n > 0), `the 3D view's canvas is ${canvas.join(' × ')}`).toBe(true);
        await shot('studio');
      });

      await test.step('the Groups drawer: a group ticks with all under it; none ticked lights nothing', async () => {
        await page.locator('.layer-name:visible').first().click();
        const playsOn = page.locator('.plays-on-btn:visible'), drawer = page.locator('.groups-drawer');
        await playsOn.click();
        await expect(drawer).toBeVisible();
        const top = drawer.locator('.tree > .tree-item > .tree-row > .tree-box').first();
        const kid = drawer.locator('.tree > .tree-item > .tree-children > .tree-item > .tree-row > .tree-box').first();
        const ticked = () => drawer.locator('.tree .tree-box').evaluateAll((bs) => bs.map((b) => b.checked));
        if (await top.isChecked()) await top.click();
        await top.click();
        expect(await ticked()).not.toContain(false);
        await top.click();
        expect(await ticked()).not.toContain(true);
        await expect(playsOn).toHaveText('Nothing');
        await kid.click();
        await expect(top).toHaveJSProperty('indeterminate', true);
        await kid.locator('xpath=..').locator('.tree-toggle').click();     // its subgroups, ticked with it
        await shot('groups');
        await top.click();
        expect(await ticked()).not.toContain(false);
        await drawer.locator('.drawer-close').click();
        await expect(drawer).toHaveCount(0);
        if (wide) return;
        const back = page.locator('.phone-back:visible');
        if (await back.count()) await back.click();      // the layer's settings: back to the list
      });

      await test.step('a param is one field: dragged across, stepped by a key', async () => {
        await page.locator('.layer-name:visible').first().click();
        const field = page.locator('.params .scrub:visible').first(), min = await field.getAttribute('aria-valuemin');
        await field.dragTo(page.locator('.params .field:has(.scrub) > label:visible').first());   // past its left end
        await expect(field).toHaveAttribute('aria-valuenow', min);
        await field.click();
        await page.keyboard.press('ArrowUp');
        await expect(field).not.toHaveAttribute('aria-valuenow', min);
        await shot('params');
        await page.locator('.save-btn:visible').click();
        await expect(page.locator('.studio.is-dirty')).toHaveCount(0);
      });

      await test.step('the code: a typo is reported, a hang paused, the fix runs again', async () => {
        if (!wide) {
          await expect(page.locator('textarea.code')).toHaveCount(0);
          return;
        }
        await open('code', 'Code');
        const code = page.locator('textarea.code:visible').first();
        const problem = page.locator('.editor .problem:visible').first();
        const original = await code.inputValue();
        await code.fill(`${original}\nfunction broken( {`);
        await expect(problem).toHaveText(/\S/, { timeout: 10_000 });
        await shot('code-error');
        await code.fill(HANG);
        await expect(problem).toHaveText(/hung/i, { timeout: 20_000 });
        await code.fill(original);
        await expect(page.locator('.editor .problem:visible', { hasText: /\S/ })).toHaveCount(0, { timeout: 15_000 });
        const late = await page.evaluate(() => new Promise((resolve) => {
          const t0 = performance.now();
          setTimeout(() => resolve(performance.now() - t0), 50);
        }));
        expect(late, 'a 50 ms timer on the page, ms (the page stays responsive)').toBeLessThan(1000);
      });

      await test.step('the timeline', async () => {
        if (!wide) {
          await expect(page.locator('.tl')).toHaveCount(0);
          await expect(page.locator('.tab[data-tab=time]')).toHaveCount(0);
          return;
        }
        await open('time', 'Timeline');
        await expect(page.locator('.tl-rows:visible').first()).toBeVisible();
        await shot('timeline');
      });

      await test.step("colours: a source's Colours take an accent (the pick tile)", async () => {
        if (!wide) {
          await page.locator('.tab[data-tab=layers]').click();
          await page.locator('.layer-name:visible').first().click();
        }
        const pick = page.locator('.params .pick-btn:visible').first();
        await pick.click();
        const tile = page.locator('.pick-pop:popover-open');
        await tile.locator('.pick-cell[aria-label=accent1]').click();
        // A custom colour: the chooser says only `input` while open (Chrome's has no OK); Add keeps it.
        await tile.getByLabel('Custom colour').fill('#ca1c1c');
        await tile.getByRole('button', { name: 'Add colour' }).click();
        await expect(tile.locator('.pick-cell[aria-label="Remove #ca1c1c"]')).toBeVisible();
        await expect(tile.locator('.pick-head .pick-strip i').last()).toHaveCSS('background-color', 'rgb(202, 28, 28)');
        for (const hex of ['#000001', '#000002', '#000003']) {
          await tile.getByLabel('Custom colour').fill(hex);
          await tile.getByRole('button', { name: 'Add colour' }).click();
        }
        await expect(tile.getByLabel('Custom colour'), 'at 4, no more').toHaveCount(0);
        await tile.getByRole('button', { name: 'Remove #000003' }).click();
        await expect(tile.getByLabel('Custom colour'), 'its × removes one').toBeVisible();
        await shot('colours');
        await page.keyboard.press('Escape');
        await expect(page.locator('.pick-pop:popover-open')).toHaveCount(0);
        await expect(pick).toContainText('accent1 #ca1c1c');
      });

      await test.step("a param's help: its row's hover text, an ⓘ on the phone", async () => {
        // Every library param has help: the first row's, as the code declares it.
        const help = page.locator('.params .field.param:visible').first();
        if (wide) {
          await expect(help).toHaveAttribute('title', /\w{3}/);
        } else {
          await help.locator('.param-info').click();
          await expect(page.locator('.params .param-help:visible')).toHaveText(/\w{3}/);
        }
        await shot('help');
      });

      await test.step('the pickers: a preset adds its layer where picked; Add a module shows one kind', async () => {
        if (!wide) await page.locator('.tab[data-tab=layers]').click();
        const add = page.locator('.pane-layers button', { hasText: 'Add' }).first();
        await add.click();
        const picker = page.locator('dialog.shelf-dialog[open]'), tree = picker.locator('.shelf-groups');
        await expect(picker.locator('.shelf-where:visible')).toHaveCount(wide ? 0 : 1);
        await expect(tree).toBeVisible({ visible: wide });
        await page.keyboard.press('Escape');                                 // closed: nothing kept
        await add.click();
        if (!wide) await picker.locator('.shelf-where:visible').click();
        const top = tree.locator('.tree > .tree-item > .tree-row'), kid = top.locator('xpath=..')
          .locator('.tree-children > .tree-item > .tree-row').first();
        await expect(top.locator('.tree-box')).toBeChecked();                // the whole rig, as Add gives it
        await top.locator('.tree-box').click();
        await kid.locator('.tree-box').click();
        const where = await kid.locator('.tree-label').textContent();
        await shot('add-groups');
        if (!wide) {
          await expect(picker.locator('.shelf-main')).toBeHidden();
          await tree.getByRole('button', { name: 'Done' }).click();
          await expect(picker.locator('.shelf-where:visible')).toHaveText(`Plays on: ${where}`);
        }
        await picker.getByRole('tab', { name: 'Presets' }).click();
        await shot('presets');
        await picker.locator('.shelf-row', { hasText: 'Palette drift' }).click();
        await expect(page.locator('.layer-name:visible', { hasText: 'Palette drift' })).toHaveCount(1);
        await page.locator('.layer-name:visible', { hasText: 'Palette drift' }).click();
        await expect(page.locator('.plays-on-btn:visible')).toHaveText(where);
        if (!wide) return;
        await page.locator('.chain-add').click();
        await picker.getByRole('tab', { name: 'Warps' }).click();
        await expect(picker.locator('.shelf-row[data-kind=warp]:visible').first()).toBeVisible();
        await expect(picker.locator('.shelf-row[data-kind=source]:visible')).toHaveCount(0);
        await shot('warps');
        await picker.locator('.shelf-row[data-kind=warp]:visible').first().click();     // added after the source
        const rows = page.locator('.chain-row');
        await expect(rows.nth(1)).toHaveClass(/selected/);
        await rows.nth(1).locator('.chain-name').focus();
        await page.keyboard.press('Alt+ArrowUp');          // a row moves from the keyboard, keeping the focus:
        await expect(page.locator('.attach-list .chain-row')).toHaveCount(1);   // attached to the source, a step,
        await expect(rows.nth(1).locator('.chain-name')).toBeFocused();
        await page.keyboard.press('Alt+ArrowUp');          // then above it
        await expect(page.locator('.attach-list .chain-row')).toHaveCount(0);
        await expect(rows.first()).toHaveAttribute('data-kind', 'warp');
        await expect(rows.first().locator('.chain-name')).toBeFocused();
        await rows.nth(1).getByRole('combobox', { name: 'Combine' }).selectOption('max');   // in the row's own line
        await expect(rows.nth(1)).toHaveAttribute('data-join', 'max');
        const name = rows.first().locator('.chain-name');      // its settings under it; a click closes and opens them
        await expect(rows.first().locator('.chain-params .params')).toBeVisible();
        await name.click();
        await expect(name).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('.chain-params')).toHaveCount(0);
        await name.click();
        await expect(rows.first().locator('.chain-params .params')).toBeVisible();
        await shot('chain');
      });

      await test.step('bake', async () => {
        if (!wide) {
          await open('look', 'Look');
          await expect(page.getByRole('button', { name: 'Check & bake', exact: true })).toHaveCount(0);
          return;
        }
        const probe = await createRenderBox({ log: quiet }).probe();
        test.skip(!probe.ok, `render box unavailable here: ${probe.reason}`);
        const checkAndBake = async () => {     // from Export on a laptop, from the Look tab on a phone
          if (wide) {
            await page.getByRole('button', { name: 'Export' }).click();
            await shot('export');
            await page.getByRole('menuitem', { name: 'Check & bake…' }).click();
          } else {
            await open('look', 'Look');
            await page.getByRole('button', { name: 'Check & bake' }).click();
          }
        };
        await checkAndBake();
        const bake = page.locator('dialog section.bake');
        const pill = bake.locator('.bake-pill');
        if (wide) {
          await bake.getByRole('button', { name: BAKE }).click();
        } else {
          // The phone bakes nothing itself; the look is baked where the laptop would, then played here.
          await expect(bake.getByText('Bake and review from a larger screen.')).toBeVisible();
          await expect(bake.getByRole('button', { name: BAKE })).toBeHidden();
          const id = new URL(page.url()).pathname.split('/').pop();
          expect((await page.request.post(`${origin}/api/looks/${id}/bake`, { data: {} })).status()).toBe(202);
          await expect.poll(async () => (await (await page.request.get(`${origin}/api/looks/${id}`)).json()).look
            .bake?.status, { timeout: 120_000 }).toBe('done');
          await page.reload();
          await checkAndBake();
        }
        await expect(pill).toHaveText('Passed', { timeout: 120_000 });
        const play = bake.locator('.bake-play');
        const badge = page.locator('.baked-badge');
        await play.click();
        await expect(badge.or(play.filter({ hasText: /MB/ }))).toBeVisible({ timeout: 60_000 });
        if (!(await badge.isVisible())) await play.click();   // on a phone's connection the first press says the size
        await expect(badge).toBeVisible({ timeout: 60_000 });
        await expect(play).toHaveAttribute('aria-pressed', 'true');
        await shot('baked');
      });

      expect(external, 'requests that left our origin').toEqual([]);
      expect(errors.filter((e) => !/Failed to load resource: the server responded with a status of 40[14]/.test(e)),
        'console errors and CSP reports').toEqual([]);
    });
  });
}
