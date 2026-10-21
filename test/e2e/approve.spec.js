// npm run smoke, too: a curator approves gallery looks in one click (SPEC "Baked frames"). Approve bakes a look that
// has no bake in the real render box (the card says Baking…), then marks it reviewed; frames that fail the flash check
// ask the curator's reason first. Screenshots land in APPROVE_SHOTS when set, else the test's output folder.
import path from 'node:path';

import { expect, test } from './studio.js';

test.use({ serverOptions: { curators: 'approve-curator-390,approve-curator-1366' } });

const layer = (code) => ({ id: 'l1', title: 'x', code, groups: ['cathedral'], blend: 'add', level: 1, params: {} });
const LOOKS = { Breathe: 'function pixel(p, t) { return scale([0.2, 0.4, 1], wave(t * 0.25)); }',
  Strobe: 'function pixel(p, t) { return floor(t * 20) % 2 ? [0, 0, 0] : [1, 1, 1]; }' };

/** Signs `username` up in `context`; with `share` (a width), shares a short look of each of LOOKS, titled and coded
 * for it, so no bake is one another test stored. */
async function account(context, origin, username, share = 0) {
  const post = (url, data) => context.request.post(origin + url, { data });
  expect((await post('/api/signup', { username, password: 'correct horse' })).status()).toBe(201);
  for (const [name, code] of share ? Object.entries(LOOKS) : []) {
    const { look } = await (await post('/api/looks', { title: `${name} ${share}`, duration: 2,
      layers: [layer(`${code} // ${share}`)] })).json();
    expect((await context.request.put(`${origin}/api/looks/${look.id}`, { data: { shared: true } })).ok()).toBe(true);
  }
}

for (const width of [390, 1366]) {
  test(`a curator approves gallery looks at ${width}`, async ({ browser, page, studio }, info) => {
    const shot = (name) => page.screenshot({ path: process.env.APPROVE_SHOTS
      ? path.join(process.env.APPROVE_SHOTS, `${width}-${name}.png`) : info.outputPath(`${name}.png`) });
    await page.setViewportSize({ width, height: width < 600 ? 844 : 768 });
    const owner = await browser.newContext();
    await account(owner, studio.origin, `approve-owner-${width}`, width);
    await owner.close();
    await account(page.context(), studio.origin, `approve-curator-${width}`);

    await page.goto(`${studio.origin}/gallery`);
    const card = (name) => page.locator('.card', { hasText: `${name} ${width}` });
    await expect(card('Breathe').getByRole('button', { name: `Approve Breathe ${width}` })).toBeVisible();
    await shot('1-before');
    await card('Breathe').getByRole('button', { name: `Approve Breathe ${width}` }).click();
    await expect(card('Breathe').getByRole('button', { name: `Approve Breathe ${width}` })).toHaveText('Baking…');
    await shot('2-baking');
    await expect(card('Breathe').locator('.tag', { hasText: 'Reviewed' })).toBeVisible({ timeout: 120_000 });
    await expect(card('Breathe').getByRole('button', { name: `Approve Breathe ${width}` })).toHaveCount(0);
    await shot('3-approved');

    await card('Strobe').getByRole('button', { name: `Approve Strobe ${width}` }).click();
    const why = page.getByRole('dialog', { name: 'Approve despite flashing?' });
    await expect(why).toBeVisible({ timeout: 120_000 });
    await why.getByLabel('Why is this flashing acceptable?').fill('The finale, announced and fenced off.');
    await shot('4-flash-reason');
    await why.getByRole('button', { name: 'Approve' }).click();
    await expect(card('Strobe').locator('.tag', { hasText: 'Reviewed' })).toBeVisible();
    if (width < 600) return;

    // Check & bake on someone else's look, with edits here: it bakes and reviews the look as shared, never a copy.
    await card('Breathe').getByRole('link', { name: 'Open' }).click();
    await page.getByRole('textbox', { name: 'Look title' }).selectText();
    await page.keyboard.type('Breathe, edited');
    await page.getByRole('button', { name: 'Export' }).click();
    await page.getByRole('menuitem', { name: 'Check & bake…' }).click();
    const bake = page.locator('dialog section.bake');
    await expect(bake).toContainText('This bakes and reviews the look as shared: its saved code, not your edits.');
    await expect(bake.getByRole('button', { name: 'Bake again' })).toBeVisible();
    await shot('5-bake-theirs');
  });
}
