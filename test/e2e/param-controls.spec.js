// Settings show only controls used by the selected mode, without resetting the hidden saved values.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, signup, test } from './studio.js';

const names = { bars: 'source', mask: 'filter', 'in-turn': 'warp', heartbeat: 'source', lightning: 'source',
  anchor: 'warp', mirror: 'warp', 'hue-shift': 'filter', 'petal-repeat': 'warp', noise: 'source', delay: 'filter',
  fireworks: 'source', 'petal-mask': 'filter' };
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
      };
      for (const name of Object.keys(names)) {
        const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST',
          body: JSON.stringify({ ...look, layers: look.layers.filter((l) => l.id === name) }),
          headers: { 'content-type': 'application/json', cookie } });
        expect(res.status, await res.clone().text()).toBe(201);
        const { look: { id } } = await res.json();
        await page.goto(`${studio.origin}/studio/${id}`);
        await page.locator('.layer-name:visible', { hasText: new RegExp(`^${name}$`) }).click();
        const button = page.locator(`[data-module="${name}"] .chain-name:visible`);
        if (await button.getAttribute('aria-current') !== 'true') await button.click();
        await expect(page.locator('.params .field.param').first()).toBeVisible();
        await shot(name);
        if (name === 'bars') {
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
        }
      }
    });
  });
}
