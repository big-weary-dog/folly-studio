// Settings show only controls used by the selected mode, without resetting the hidden saved values.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, signup, test } from './studio.js';

const names = { bars: 'source', mask: 'filter', 'in-turn': 'warp', heartbeat: 'source', lightning: 'source',
  anchor: 'warp', mirror: 'warp', 'hue-shift': 'filter', 'petal-repeat': 'warp', noise: 'source', delay: 'filter',
  fireworks: 'source', 'petal-mask': 'filter', replay: 'filter', 'single-strand': 'source', streaks: 'source',
  reorder: 'warp', strobe: 'source', recolour: 'filter', 'ring-turn': 'warp', picture: 'source', waves: 'source',
  twist: 'warp' };
const code = (name) => readFileSync(new URL(`../../public/patterns/${name}.js`, import.meta.url), 'utf8');
const look = { title: 'Pattern controls', duration: 16, layers: Object.entries(names).map(([name, kind]) => ({
  id: name, title: name, modules: [
    ...(kind === 'source' ? [] : [{ id: 'bed', kind: 'source', ref: 'colour-wash', code: code('colour-wash') }]),
    { id: name, title: name, ref: name, kind, code: code(name), params: name === 'bars' ? { duty: 0.37 } : {} },
  ],
})) };
const DEVICES = { laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };

for (const [device, settings] of Object.entries(DEVICES)) {
  test.describe(device, () => {
    test.use(settings);
    test('mode controls retain hidden settings', async ({ page, studio }, info) => {
      const cookie = await signup(studio.origin, `controls-${device}`);
      const [key, value] = cookie.split('=');
      await page.context().addCookies([{ name: key, value, url: studio.origin }]);
      const row = (text) => page.locator('.params .field.param', { hasText: text });
      const select = (label, value) => row(label).locator('select').selectOption(value);
      const shot = async (name) => {
        const out = process.env.PARAM_SHOTS || info.outputDir;
        mkdirSync(out, { recursive: true });
        await page.locator('.params').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, `${device}-${name}.png`) });
        await page.locator('.params').screenshot({ path: path.join(out, `${device}-${name}-panel.png`),
          style: '.side, .pane-body { overflow: visible !important; }' });
      };
      for (const name of process.env.PARAM_SOFT_ONLY ? ['twist'] : Object.keys(names)) {
        const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST',
          body: JSON.stringify({ ...look, layers: look.layers.filter((l) => l.id === name) }),
          headers: { 'content-type': 'application/json', cookie } });
        expect(res.status, await res.clone().text()).toBe(201);
        const { look: { id } } = await res.json();
        await page.goto(`${studio.origin}/studio/${id}`);
        await page.locator('.layer-name:visible', { hasText: new RegExp(`^${name}$`) }).click();
        if (device === 'phone') await page.locator('.phone-module-picker').click();
        const button = page.locator(`[data-module="${name}"] .chain-name:visible`);
        if (await button.getAttribute('aria-current') !== 'true') await button.click();
        await expect(page.locator('.params .field.param').first()).toBeVisible();
        if (device === 'phone') await page.getByText('More settings', { exact: true }).click();
        await shot(name);
        if (name === 'twist') {
          const input = row('Swirl').getByRole('spinbutton');
          await input.fill('-6');
          await input.press('Tab');
          await expect(input).toHaveValue('-6.00');
          await expect(input).toHaveAttribute('aria-valuenow', '-6');
          expect(await input.evaluate((el) => el.style.getPropertyValue('--fill'))).toBe('0.000');
          await shot('twist-minus-six');
          await input.fill('6');
          await input.press('Tab');
          await expect(input).toHaveValue('6.00');
          expect(await input.evaluate((el) => el.style.getPropertyValue('--fill'))).toBe('1.000');
          await input.fill('-99');
          await input.press('Tab');
          await expect(input).toHaveValue('-8.00');
        } else if (name === 'bars') {
          await select('Profile', 'smooth');
          await expect(row('Duty')).toHaveCount(0);
          await expect(row('Edge softness')).toHaveCount(0);
          await shot('bars-smooth');
          await select('Profile', 'step');
          await expect(row('Duty').locator('input').first()).toHaveValue('0.37');
        } else if (name === 'mask') {
          await expect(row('Region rule')).toHaveCount(0);
          await select('Mask by', 'region');
          await expect(row('Brightness where it opens')).toHaveCount(0);
          await expect(row('Scatter')).toHaveCount(0);
          await expect(row('Petals a region')).toHaveCount(0);
          await select('Region rule', 'checker');
          await expect(row('Petals a region')).toBeVisible();
          await select('Show regions', 'every');
          await expect(row('Region index')).toBeVisible();
          await shot('mask-region');
        } else if (name === 'in-turn') {
          await expect(row('Drops at once')).toHaveCount(0);
          await select('Each', 'drops');
          await expect(row('Groups (tag)')).toHaveCount(0);
          await expect(row('Drops at once')).toBeVisible();
          await select('Gate', 'flash');
          await expect(row('Direction')).toHaveCount(0);
          await shot('in-turn-drops');
        } else if (name === 'heartbeat') {
          await expect(row('Own tempo')).toHaveCount(0);
          await select('Tempo', 'own');
          await expect(row('Own tempo')).toBeVisible();
          await select('Shape', 'single');
          await expect(row('Second beat')).toHaveCount(0);
          await shot('heartbeat-own');
        } else if (name === 'noise') {
          await expect(row('Detail')).toHaveCount(0);
          await select('Kind', 'static');
          await expect(row('Size')).toHaveCount(0);
          await shot('noise-static');
          await select('Kind', 'layered');
          await expect(row('Detail')).toBeVisible();
          await row('Speed').locator('.beat-clock').click();
          await expect(row('Speed')).toContainText('changes a beat');
        } else {
          if (name === 'single-strand') {
            await expect(row('Comet tail')).toHaveCount(0);
            await row('Gap').locator('input').first().fill('0.37');
            await row('Gap').locator('input').first().press('Tab');
            await select('Profile', 'comet');
            await expect(row('Gap')).toHaveCount(0);
            await expect(row('Comet tail')).toBeVisible();
            await select('Mode', 'out');
            await expect(row('Alternate strands')).toHaveCount(0);
            await shot('single-strand-comet-out');
            await select('Profile', 'bands');
            await expect(row('Gap').locator('input').first()).toHaveValue('0.37');
          } else if (name === 'streaks') {
            await expect(row('Sway')).toHaveCount(0);
            await select('Profile', 'flake');
            await expect(row('Tail')).toHaveCount(0);
            await expect(row('Sway')).toBeVisible();
            await shot('streaks-flake');
          } else if (name === 'replay') {
            await select('Play', 'hold');
            await expect(row('Length')).toHaveCount(0);
            await shot('replay-hold');
          } else if (name === 'reorder') {
            await expect(row('Seed')).toHaveCount(0);
            await select('Order by', 'random');
            await expect(row('From')).toHaveCount(0);
            await expect(row('Reach')).toHaveCount(0);
            await expect(row('Seed')).toBeVisible();
            await shot('reorder-random');
          }
        }
      }
    });
  });
}
