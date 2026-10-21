// npm run smoke, too: the tutorial (SPEC-tutorial), Rose and arches' chapters played by their steps' own controls at a
// laptop's size and a shorter window. Each step's control is ringed inside the window (scrolled into view in whatever
// panel scrolls), its goal is not already met when it opens, and the card keeps off the preview. A new account meets
// the welcome and finds Getting around ticked in Tutorials; on a phone nothing opens and nothing is marked. With
// TOUR_SHOTS set to a folder, each step's screenshot (at 1366 × 768) goes there.
import path from 'node:path';

import { expect, signup, test } from './studio.js';
import { playIdea, playKeep, playLayers, playModules, playMoves, playTime } from './tour-paths.js';

test.use({ tourWelcome: true });

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

/** A new account's cookie on the page's context. */
async function signedIn(page, origin, name) {
  const [k, v] = (await signup(origin, name)).split('=');
  await page.context().addCookies([{ name: k, value: v, url: origin }]);
}

/** How far (px) the ring is from round the step's control (the last of `names` on screen, as the tour picks it), or
 * 999 when that control is not wholly inside the window and every panel that clips it. */
const ringOff = (page, names) => page.evaluate((names) => {
  const PAD = 6, ring = document.querySelector('.tour-ring')?.getBoundingClientRect();
  const el = names.map((n) => document.querySelector(`[data-tour~="${n}"]`))
    .filter((e) => e?.getClientRects().length && e.checkVisibility({ visibilityProperty: true })).at(-1);
  if (!ring || !el) return 999;
  const r = el.getBoundingClientRect();
  let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const b = p.getBoundingClientRect();
    clip = { left: Math.max(clip.left, b.left), top: Math.max(clip.top, b.top), right: Math.min(clip.right, b.right),
      bottom: Math.min(clip.bottom, b.bottom) };
  }
  if (r.left < clip.left - 1 || r.top < clip.top - 1 || r.right > clip.right + 1 || r.bottom > clip.bottom + 1) {
    return 999;
  }
  return Math.max(Math.abs(ring.left - (r.left - PAD)), Math.abs(ring.top - (r.top - PAD)),
    Math.abs(ring.right - (r.right + PAD)), Math.abs(ring.bottom - (r.bottom + PAD)));
}, names);

/** How many px² of the preview the step's card covers. */
const cardOnPreview = (page) => page.evaluate(() => {
  const a = document.querySelector('.tour-step')?.getBoundingClientRect();
  const b = document.querySelector('[data-tour~="preview"]')?.getBoundingClientRect();
  if (!a || !b) return 0;
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
});

/** The open step's card and what a path's test does with it. */
function steps(page, info, { shots = true } = {}) {
  const card = page.locator('.tour-step');
  let now = '';
  const t = {
    card,
    title: (s) => expect(card.locator('h2')).toHaveText(s, { timeout: 30_000 }),
    /** A step opens: its title, then its goal not met by what the Studio already shows. */
    open: async (s) => {
      await t.title(s);
      now = s;
      await page.waitForTimeout(400);   // the step's first check has run
      await expect(card, `"${s}" is not done before anything changes`).not.toHaveClass(/done/);
    },
    ring: (...names) => expect.poll(() => ringOff(page, names), { message: `the ring round ${names.join(' or ')}, `
      + 'inside the window', timeout: 3000 }).toBeLessThan(3),
    /** A ring that has just appeared is already round its control, not sliding in from elsewhere. */
    ringAt: async (...names) => {
      await expect(page.locator('.tour-ring')).toBeVisible();
      expect(await ringOff(page, names), `the new ring round ${names.join(' or ')}`).toBeLessThan(3);
    },
    /** Once settled (it slides as the ring does), the card keeps off the preview. */
    offPreview: () => expect.poll(() => cardOnPreview(page), { message: 'the card keeps off the preview',
      timeout: 2000 }).toBe(0),
    /** Done: marked so, or already moved on by itself (it does 600 ms after, maybe before the act's last click). */
    done: () => expect.poll(() => card.evaluate((el, s) => el.classList.contains('done')
      || el.querySelector('h2')?.textContent !== s, now), { message: `"${now}" is done` }).toBe(true),
    next: () => card.getByRole('button', { name: /^(Next|Finish)$/ }).click(),
    at: (name) => page.locator(`[data-tour~="${name}"]`),
    shot: (name) => (shots ? page.screenshot({ timeout: 60_000, path: process.env.TOUR_SHOTS
      ? path.join(process.env.TOUR_SHOTS, `${name}.png`) : info.outputPath(`${name}.png`) }) : undefined),
  };
  return t;
}
/** A path from Tutorials in the user menu, on an account that has seen the welcome. */
async function fromTutorials(page, origin, user, title) {
  await signedIn(page, origin, user);
  await page.goto(`${origin}/`);
  await page.evaluate(() => fetch('/api/me/tour', { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seen: true, done: [] }) }));
  await page.reload();
  await page.locator('[data-tour="user-menu"]').click();
  await page.getByRole('button', { name: 'Tutorials' }).click();
  await page.locator('.tour-path', { hasText: title }).click();
}
/** The path finished: Tutorials says so, and so does the account. */
async function finished(page, title, id) {
  await expect(page.getByRole('dialog', { name: `${title}: done` })).toBeVisible();
  const me = await page.evaluate(() => fetch('/api/me').then((r) => r.json()));
  expect(me.user.tour.done).toContain(id);
}

for (const height of [768, 660]) {
  test.describe(`laptop, 1366 × ${height}`, () => {
    test.use({ viewport: { width: 1366, height } });
    const shots = height === 768;

    test('Getting around: the welcome, each step by its control, then Tutorials', async ({ page, studio }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const s = steps(page, info, { shots }), { ring, ringAt, open, at, shot, offPreview } = s;
      await signedIn(page, studio.origin, `first-look-${height}`);
      await page.goto(`${studio.origin}/`);

      const welcome = page.getByRole('dialog', { name: 'Welcome to Folly Studio' });
      await expect(welcome).toBeVisible({ timeout: 30_000 });
      await shot('first-look-welcome');
      await welcome.getByRole('button', { name: 'Start the tour' }).click();

      await open('Turn the model');
      await ringAt('preview');
      await offPreview();
      const box = await at('preview').boundingBox(), mid = [box.x + box.width / 2, box.y + box.height / 2];
      await page.mouse.move(...mid);
      await page.mouse.down();
      await page.mouse.move(mid[0] + 160, mid[1], { steps: 8 });
      await page.mouse.up();
      await s.done();
      await shot('first-look-turn');

      await open('A view');
      await ring('view-bar', 'view:rose');
      await at('view:rose').click();
      await s.done();
      await shot('first-look-rose');

      await open('Zoom');
      await ring('preview');
      await page.mouse.move(...mid);
      await page.mouse.wheel(0, -600);
      await s.done();
      await shot('first-look-zoom');

      await open('The whole Folly');
      await ring('view-bar', 'view:fit');
      await at('view:fit').click();
      await s.done();
      await shot('first-look-fit');

      await open('Pause and play');
      await ring('play');
      await at('play').click();
      await expect(at('play')).toHaveAttribute('aria-label', 'Play');
      await at('play').click();
      await s.done();
      await shot('first-look-pause');

      await open('Ideas');
      await ring('nav:ideas');
      await at('nav:ideas').click();
      await s.done();
      await shot('first-look-ideas');
      await s.next();

      const menu = page.getByRole('dialog', { name: 'Getting around: done' });
      await expect(menu).toBeVisible();
      await expect(menu.locator('.tour-path[data-state=done]')).toHaveCount(1);
      await shot('first-look-finished');
      await menu.getByRole('button', { name: 'Close the tutorial' }).click();

      // Kept on the account: a reload opens nothing, and the account says Getting around is done.
      await page.reload();
      await expect(page.locator('#tour')).toHaveCount(0);
      const me = await page.evaluate(() => fetch('/api/me').then((r) => r.json()));
      expect(me.user.tour).toEqual({ seen: true, done: ['first-look'] });
      expect(errors).toEqual([]);
    });

    for (const [title, id, play] of [['From an idea', 'idea', playIdea], ['Modules and colour', 'modules', playModules],
      ['Layers and chains', 'layers', playLayers], ['Time', 'time', playTime], ['Values that move', 'moves', playMoves],
      ['Keep it, show it', 'keep', playKeep]]) {
      test(title, async ({ page, studio }, info) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await fromTutorials(page, studio.origin, `${id}-${height}`, title);
        await play(page, steps(page, info, { shots }));
        await finished(page, title, id);
        expect(errors).toEqual([]);
      });
    }
  });
}

test.describe('laptop, 1366 × 768: unsaved edits', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('a practice path over unsaved edits: Cancel keeps them, Leave starts it', async ({ page, studio }, info) => {
    const { card, title, at } = steps(page, info);
    await fromTutorials(page, studio.origin, 'unsaved', 'Getting around');
    await title('Turn the model');
    await card.getByRole('button', { name: 'Close the tutorial' }).click();
    await page.goto(`${studio.origin}/studio`);
    const level = at('level:colour-wash').locator('input');
    await level.fill('40');
    await level.press('Enter');
    const pick = async () => {
      await at('user-menu').click();
      await page.getByRole('button', { name: 'Tutorials' }).click();
      await page.locator('.tour-path', { hasText: 'Modules and colour' }).click();
      return page.getByRole('dialog', { name: 'Unsaved changes' });
    };
    await (await pick()).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Tutorials' })).toBeVisible();
    await expect(card).toHaveCount(0);
    await expect(at('level:colour-wash')).toBeVisible();
    await page.getByRole('dialog', { name: 'Tutorials' }).getByRole('button', { name: 'Close the tutorial' }).click();
    await (await pick()).getByRole('button', { name: 'Leave' }).click();
    await title('A number');
    await expect(page).toHaveURL(/\/studio\?tour=modules$/);
  });
});

test.describe('phone, 390 × 844', () => {
  test.use(PHONE);

  test('nothing opens, nothing is marked', async ({ page, studio }, info) => {
    await signedIn(page, studio.origin, 'phone-visit');
    await page.goto(`${studio.origin}/studio`);
    await expect(page.locator('.studio')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1000);   // the welcome would have loaded by now
    await expect(page.locator('#tour')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('closed.png') });
    const me = await page.evaluate(() => fetch('/api/me').then((r) => r.json()));
    expect(me.user.tour).toBeUndefined();
  });
});
