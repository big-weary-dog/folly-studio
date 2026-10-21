// npm run smoke, too: the tutorial (SPEC-tutorial). At a laptop's size a new account meets the welcome, plays First
// look by the steps' own controls, and finds it ticked in Tutorials; on a phone nothing opens and nothing is marked.
// With TOUR_SHOTS set to a folder, each step's screenshot goes there.
import path from 'node:path';

import { expect, signup, test } from './studio.js';

test.use({ tourWelcome: true });

const LAPTOP = { viewport: { width: 1366, height: 768 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

const shooter = (page, info, width) => (name) => page.screenshot({ timeout: 60_000,
  path: process.env.TOUR_SHOTS ? path.join(process.env.TOUR_SHOTS, `${width}-${name}.png`)
    : info.outputPath(`${name}.png`) });

/** A new account's cookie on the page's context. */
async function signedIn(page, origin, name) {
  const [k, v] = (await signup(origin, name)).split('=');
  await page.context().addCookies([{ name: k, value: v, url: origin }]);
}

/** How far (px) the ring is from round the step's control: the last of `names` on screen, as the tour picks it. */
const ringOff = (page, names) => page.evaluate((names) => {
  const PAD = 6, ring = document.querySelector('.tour-ring')?.getBoundingClientRect();
  const el = names.map((n) => document.querySelector(`[data-tour~="${n}"]`))
    .filter((e) => e?.getClientRects().length && e.checkVisibility({ visibilityProperty: true })).at(-1);
  if (!ring || !el) return 999;
  const r = el.getBoundingClientRect();
  return Math.max(Math.abs(ring.left - (r.left - PAD)), Math.abs(ring.top - (r.top - PAD)),
    Math.abs(ring.right - (r.right + PAD)), Math.abs(ring.bottom - (r.bottom + PAD)));
}, names);

/** The open step's card: wait for its title, see the ring on its control, see it done, press Next (or Finish). */
function steps(page) {
  const card = page.locator('.tour-step');
  return {
    card,
    title: (t) => expect(card.locator('h2')).toHaveText(t, { timeout: 30_000 }),
    ring: (...names) => expect.poll(() => ringOff(page, names), { message: `the ring round ${names.join(' or ')}`,
      timeout: 3000 }).toBeLessThan(3),
    /** A ring that has just appeared is already round its control, not sliding in from elsewhere. */
    ringAt: async (...names) => {
      await expect(page.locator('.tour-ring')).toBeVisible();
      expect(await ringOff(page, names), `the new ring round ${names.join(' or ')}`).toBeLessThan(3);
    },
    done: () => expect(card).toHaveClass(/done/),
    next: () => card.getByRole('button', { name: /^(Next|Finish)$/ }).click(),
    at: (name) => page.locator(`[data-tour~="${name}"]`),
  };
}
/** Type into a Scrub (or number) field and commit it. */
async function type(field, value) {
  await field.fill(String(value));
  await field.press('Enter');
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

test.describe('laptop, 1366 × 768', () => {
  test.use(LAPTOP);

  test('First look: the welcome, each step by its control, then Tutorials', async ({ page, studio }, info) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const shot = shooter(page, info, 1366), { card, title, ring, ringAt, next: nextStep, at } = steps(page);
    await signedIn(page, studio.origin, 'first-look');
    await page.goto(`${studio.origin}/`);

    const welcome = page.getByRole('dialog', { name: 'Welcome to Folly Studio' });
    await expect(welcome).toBeVisible({ timeout: 30_000 });
    await shot('welcome');
    await welcome.getByRole('button', { name: 'Start the tour' }).click();

    await title('Still being built');
    await ringAt('user-menu');
    await shot('report');
    await nextStep();

    await title('The Studio');
    await ring('nav:studio');
    await at('nav:studio').click();
    await title('Add a preset');
    await ring('layers-add');
    await shot('preset');
    await at('layers-add').click();
    await at('shelf-tab:preset').click();
    await ring('shelf-tab:preset');
    await shot('shelf');
    await at('shelf:starfield').click();

    await title('Look around');
    await ring('view-bar', 'view:rose');
    await at('view:rose').click();

    await title('Open a module');
    await ring('layer:starfield', 'module:sparkle');
    await shot('module');
    await at('module:sparkle').click();

    await title('Change a value');
    await ring('param:density');
    const density = at('param:density').locator('input').first();
    await density.fill('0.9');
    await density.press('Enter');
    await expect(card).toHaveClass(/done/);
    await ring('param:density');
    await shot('value');

    await title('Mute, then keep it');
    await ring('mute:colour-wash');
    await at('mute:colour-wash').click();
    await expect(card).toHaveClass(/done/);
    await ring('mute:colour-wash');
    await shot('mute');
    await nextStep();

    const menu = page.getByRole('dialog', { name: 'First look: done' });
    await expect(menu).toBeVisible();
    await expect(menu.locator('.tour-path[data-state=done]')).toHaveCount(1);
    await shot('finished');
    await menu.getByRole('button', { name: 'Close the tutorial' }).click();

    // Kept on the account: a reload opens nothing, and the account says First look is done.
    await page.reload();
    await expect(page.locator('#tour')).toHaveCount(0);
    const me = await page.evaluate(() => fetch('/api/me').then((r) => r.json()));
    expect(me.user.tour).toEqual({ seen: true, done: ['first-look'] });
    expect(errors).toEqual([]);
  });

  test('Layers and chains', async ({ page, studio }, info) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const shot = shooter(page, info, 1366), { title, ring, done, next, at } = steps(page);
    await fromTutorials(page, studio.origin, 'layers', 'Layers and chains');
    await title('A stack of layers');
    await ring('layers', 'layer:lighthouse');
    await shot('layers-select');
    await at('layer:lighthouse').locator('.layer-name').click();
    await title('Where it plays');
    await ring('plays-on');
    await at('plays-on').click();
    await page.locator('#grp-cathedral').uncheck();
    await page.locator('#grp-rose-window').check();
    await ring('plays-on', 'group:rose-window');
    await shot('layers-plays-on');
    await at('plays-on').click();
    await title('How layers mix');
    await ring('blend:lighthouse');
    await at('blend:lighthouse').selectOption('max');
    await title('How bright');
    await ring('level:lighthouse');
    await type(at('level:lighthouse').locator('input'), 50);
    await title('The order');
    await ring('move-layer-down');
    await at('move-layer-down').click();
    await title('Add to the chain');
    await ring('chain-add');
    await at('chain-add').click();
    await at('shelf-tab:warp').click();
    await ring('shelf-tab:warp', 'shelf:mirror');
    await at('shelf:mirror').click();
    await title('Off, not gone');
    await ring('module-on:mirror');
    await at('module-on:mirror').click();
    await title('Soften the edges');
    await ring('soften');
    await type(at('soften').locator('input').first(), 12);
    await done();
    await ring('soften');
    await shot('layers-soften');
    await next();
    await finished(page, 'Layers and chains', 'layers');
    expect(errors).toEqual([]);
  });

  test('Movement and time', async ({ page, studio }, info) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const shot = shooter(page, info, 1366), { title, ring, done, next, at } = steps(page);
    await fromTutorials(page, studio.origin, 'move', 'Movement and time');
    await title('Play and pause');
    await ring('play');
    await at('play').click();
    await title('Find the bars');
    await ring('layer:plasma', 'module:bars');
    await at('layer:plasma').locator('.layer-name').click();     // Bars, its first source, opens by itself
    await title('A value that moves');
    await ring('param:bars');
    await at('param:bars').locator('.param-mod').click();
    await page.locator('.mod-drawer .mod-seg', { hasText: 'LFO' }).click();
    await shot('move-lfo');
    await at('param:bars').locator('.param-mod').click();
    await title('The tempo');
    await ring('dock:timeline', 'bpm');
    await at('dock:timeline').click();
    await ring('dock:timeline', 'bpm');
    await type(at('bpm').locator('input'), 120);
    await title('On the beat');
    await ring('param:speed');
    await at('param:speed').locator('.beat-clock').click();
    await title('A clip');
    await ring('dock:timeline', 'clip-add');
    await at('clip-add').click();
    await title('Automation');
    await ring('dock:timeline', 'automate');
    await at('automate').click();   // + Automate… loads the lanes; their own + Automate… picks one
    await ring('dock:timeline', 'automate');
    await at('automate').selectOption({ index: 1 });
    const lane = page.locator('.tl-auto-svg').first(), box = await lane.boundingBox();
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.3);
    await done();
    await ring('dock:timeline', 'automate');
    await shot('move-automate');
    await next();
    await finished(page, 'Movement and time', 'move');
    expect(errors).toEqual([]);
  });

  test('Colour', async ({ page, studio }, info) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const shot = shooter(page, info, 1366), { title, ring, done, next, at } = steps(page);
    await fromTutorials(page, studio.origin, 'colour', 'Colour');
    await title('Find the colours');
    await ring('layer:lighthouse', 'module:bars');
    await done();   // the practice look opens on it; the step says so and waits for Next
    await next();
    await title('Pick colours');
    await ring('param:colours');
    await at('param:colours').locator('.pick-btn').click();
    await page.locator('.pick-pop:popover-open .pick-cell[aria-label=accent1]').click();
    await ring('param:colours');
    await shot('colour-pick');
    await page.keyboard.press('Escape');
    await title('The whole look');
    await ring('dock:look');
    await at('dock:look').click();
    await title('The palette');
    await ring('palette');
    await at('palette').locator('select').selectOption({ index: 2 });
    await done();
    await ring('palette');
    await shot('colour-palette');
    await next();
    await finished(page, 'Colour', 'colour');
    expect(errors).toEqual([]);
  });

  test('Keep it, show it', async ({ page, studio }, info) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const shot = shooter(page, info, 1366), { title, ring, ringAt, done, next, at } = steps(page);
    await fromTutorials(page, studio.origin, 'keep', 'Keep it, show it');
    await title('Change something');
    await ring('layers');
    await type(at('level:starfield').locator('input'), 70);
    await title('Step back');
    await ring('history', 'undo');
    await at('history').click();
    await ring('history', 'undo');
    await at('undo').click();
    await shot('keep-undo');
    await at('history').click();
    await title('Save');
    await ring('save');
    await at('save').click();
    await title('Live');
    await ring('nav:live');
    await at('nav:live').click();
    await title('Describe an idea');
    await at('nav:ideas').click();
    await ringAt('idea');
    await at('idea').fill('Slow embers rising up the spires');
    await done();
    await ring('idea');
    await shot('keep-idea');
    await next();
    await finished(page, 'Keep it, show it', 'keep');
    expect(errors).toEqual([]);
  });

  test('a practice path over unsaved edits: Cancel keeps them, Leave starts it', async ({ page, studio }) => {
    const { card, title, at } = steps(page);
    await fromTutorials(page, studio.origin, 'unsaved', 'First look');
    await title('Still being built');
    await card.getByRole('button', { name: 'Close the tutorial' }).click();
    await page.goto(`${studio.origin}/studio`);
    await type(at('level:colour-wash').locator('input'), 40);
    const pick = async () => {
      await at('user-menu').click();
      await page.getByRole('button', { name: 'Tutorials' }).click();
      await page.locator('.tour-path', { hasText: 'Colour' }).click();
      return page.getByRole('dialog', { name: 'Unsaved changes' });
    };
    await (await pick()).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Tutorials' })).toBeVisible();
    await expect(card).toHaveCount(0);
    await expect(at('level:colour-wash')).toBeVisible();
    await page.getByRole('dialog', { name: 'Tutorials' }).getByRole('button', { name: 'Close the tutorial' }).click();
    await (await pick()).getByRole('button', { name: 'Leave' }).click();
    await title('Find the colours');
    await expect(page).toHaveURL(/\/studio\?tour=colour$/);
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
    await shooter(page, info, 390)('closed');
    const me = await page.evaluate(() => fetch('/api/me').then((r) => r.json()));
    expect(me.user.tour).toBeUndefined();
  });
});
