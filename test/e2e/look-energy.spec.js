// npm run smoke, too: the Look panel at a laptop's and a phone's size. A fresh look has no Energy; a look from before
// the globals went (energy, speed, level, hue, saturation) opens with Energy as a fader of its own and nothing else
// of those.
import { readFileSync } from 'node:fs';

import { expect, signup, test } from './studio.js';

const code = (name) => readFileSync(new URL(`../../public/patterns/${name}.js`, import.meta.url), 'utf8');
const clouds = { title: 'Clouds', modules: [{ id: 'm1', kind: 'source', ref: 'clouds', code: code('clouds'),
  params: { speed: { mod: 'global', name: 'energy', from: 0.1, to: 0.6 } } }] };
const LOOKS = {
  fresh: { title: 'Fresh', layers: [{ ...clouds, modules: [{ ...clouds.modules[0], params: {} }] }] },
  energy: { title: 'Old storm', layers: [clouds],
    globals: { energy: 0.7, speed: 1.5, level: 0.8, hue: 0.1, saturation: 1.2, palette: 'ember' } },
};

for (const [size, viewport] of [['laptop', { width: 1366, height: 768 }], ['phone', { width: 390, height: 844 }]]) {
  test.describe(size, () => {
    test.use({ viewport });
    test(`the Look panel: Energy only on a look that uses it (${size})`, async ({ page, studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const cookie = await signup(studio.origin, `energy-${size}`);
      const [name, value] = cookie.split('=');
      await page.context().addCookies([{ name, value, url: studio.origin }]);
      for (const [which, look] of Object.entries(LOOKS)) {
        const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST', body: JSON.stringify(look),
          headers: { 'content-type': 'application/json', cookie } });
        expect(res.status).toBe(201);
        await page.goto(`${studio.origin}/studio/${(await res.json()).look.id}`);
        if (size === 'laptop') await page.locator('.dock-tab', { hasText: 'Look' }).click({ timeout: 30_000 });
        else await page.locator('.tab[data-tab=look]').click({ timeout: 30_000 });
        const panel = page.locator('.look-globals:visible');
        await expect(panel).toBeVisible({ timeout: 30_000 });
        const names = panel.locator('input.macro-name');
        if (which === 'fresh') await expect(names).toHaveCount(0);
        else {
          await expect(names).toHaveCount(1);
          await expect(names).toHaveValue('energy');
        }
        for (const gone of ['Speed', 'Level', 'Hue', 'Saturation']) {
          await expect(panel.getByText(gone, { exact: true })).toHaveCount(0);
        }
        await panel.screenshot({ path: info.outputPath(`${size}-${which}.png`) });
      }
      expect(errors).toEqual([]);
    });
  });
}
