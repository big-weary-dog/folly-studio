// npm run smoke: a text param with `lines` (rhythm's Pattern) shows a line per place, stacked and in monospace, at a
// laptop's and a phone's size; what it stores is still the lines with spaces between.
import { readFileSync } from 'node:fs';

import { expect, signup, test } from './studio.js';

const code = (name) => readFileSync(new URL(`../../public/patterns/${name}.js`, import.meta.url), 'utf8');
const PATTERN = 'X...X...X...X... ..x...x...x...x. x.x.x.x.x.x.x.x.';
const look = { title: 'Drums', duration: 16, bpm: 120, layers: [{ title: 'Kit', modules: [
  { id: 'm1', kind: 'source', ref: 'bars', code: code('bars') },
  { id: 'm2', kind: 'filter', ref: 'rhythm', code: code('rhythm'),
    params: { pattern: PATTERN, tag: 'tower arch rose' } },
] }] };

const DEVICES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

for (const [name, device] of Object.entries(DEVICES)) {
  test.describe(`${name}`, () => {
    test.use(device);
    test('rhythm\'s Pattern is a line per place', async ({ page, studio }, info) => {
      const cookie = await signup(studio.origin, `lines-${name}`);
      const res = await fetch(`${studio.origin}/api/looks`, { method: 'POST', body: JSON.stringify(look),
        headers: { 'content-type': 'application/json', cookie } });
      expect(res.status).toBe(201);
      const { look: { id } } = await res.json();
      const [key, value] = cookie.split('=');
      await page.context().addCookies([{ name: key, value, url: studio.origin }]);
      await page.goto(`${studio.origin}/studio/${id}`);
      if (name === 'phone') await page.locator('.layer-name:visible').first().click({ timeout: 30_000 });
      await page.locator('.chain-name:visible', { hasText: /rhythm/i }).click({ timeout: 30_000 });
      const field = page.locator('.field.param', { hasText: 'Pattern' });
      await field.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`${name}.png`) });
      await field.screenshot({ path: info.outputPath(`${name}-field.png`) });

      const box = field.locator('textarea.param-lines');
      await expect(box).toHaveValue(PATTERN.split(' ').join('\n'));
      const m = await box.evaluate((el) => ({ font: getComputedStyle(el).fontFamily,
        scroll: el.scrollWidth - el.clientWidth, rows: el.rows }));
      expect(m.font).toMatch(/mono/i);
      expect(m.scroll, '16 steps fit unscrolled').toBeLessThanOrEqual(1);
      expect(m.rows).toBeGreaterThanOrEqual(3);

      await box.fill('X.......\n\n  ..x.....  \nx.x.x.x.');   // blank lines and stray spaces fold away
      await box.blur();
      const saved = await page.evaluate(() => document.querySelector('textarea.param-lines').value);
      expect(saved).toBe('X.......\n..x.....\nx.x.x.x.');
    });
  });
}
