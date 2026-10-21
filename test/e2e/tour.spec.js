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

/** The open step's card: wait for its title, see it done, press Next (or Finish). */
function steps(page) {
  const card = page.locator('.tour-step');
  return {
    card,
    title: (t) => expect(card.locator('h2')).toHaveText(t, { timeout: 30_000 }),
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
    const shot = shooter(page, info, 1366), { card, title, next: nextStep } = steps(page);
    await signedIn(page, studio.origin, 'first-look');
    await page.goto(`${studio.origin}/`);

    const welcome = page.getByRole('dialog', { name: 'Welcome to Folly Studio' });
    await expect(welcome).toBeVisible({ timeout: 30_000 });
    await shot('welcome');
    await welcome.getByRole('button', { name: 'Start the tour' }).click();

    await title('Still being built');
    await expect(page.locator('.tour-ring')).toBeVisible();
    await shot('report');
    await nextStep();

    await title('The Studio');
    await page.locator('[data-tour="nav:studio"]').click();
    await title('Add a preset');
    await shot('preset');
    await page.locator('[data-tour="layers-add"]').click();
    await page.locator('[data-tour="shelf-tab:preset"]').click();
    await shot('shelf');
    await page.locator('[data-tour="shelf:starfield"]').click();

    await title('Look around');
    await page.locator('[data-tour="view:rose"]').click();

    await title('Open a module');
    await shot('module');
    await page.locator('[data-tour="module:sparkle"]').click();

    await title('Change a value');
    const density = page.locator('[data-tour="param:density"] input').first();
    await density.fill('0.9');
    await density.press('Enter');
    await expect(card).toHaveClass(/done/);
    await shot('value');

    await title('Mute, then keep it');
    await page.locator('[data-tour="mute:colour-wash"]').click();
    await expect(card).toHaveClass(/done/);
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
    const shot = shooter(page, info, 1366), { title, done, next, at } = steps(page);
    await fromTutorials(page, studio.origin, 'layers', 'Layers and chains');
    await title('A stack of layers');
    await shot('layers-select');
    await at('layer:lighthouse').locator('.layer-name').click();
    await title('Where it plays');
    await at('plays-on').click();
    await page.locator('#grp-cathedral').uncheck();
    await page.locator('#grp-rose-window').check();
    await shot('layers-plays-on');
    await at('plays-on').click();
    await title('How layers mix');
    await at('blend:lighthouse').selectOption('max');
    await title('How bright');
    await type(at('level:lighthouse').locator('input'), 50);
    await title('The order');
    await at('move-layer-down').click();
    await title('Add to the chain');
    await at('chain-add').click();
    await at('shelf-tab:warp').click();
    await at('shelf:mirror').click();
    await title('Off, not gone');
    await at('module-on:mirror').click();
    await title('Soften the edges');
    await type(at('soften').locator('input').first(), 12);
    await done();
    await shot('layers-soften');
    await next();
    await finished(page, 'Layers and chains', 'layers');
    expect(errors).toEqual([]);
  });

  test('Movement and time', async ({ page, studio }, info) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const shot = shooter(page, info, 1366), { title, done, next, at } = steps(page);
    await fromTutorials(page, studio.origin, 'move', 'Movement and time');
    await title('Play and pause');
    await at('play').click();
    await title('Find the bars');
    await at('layer:plasma').locator('.layer-name').click();
    await at('module:bars').click();
    await title('A value that moves');
    await at('param:bars').locator('.param-mod').click();
    await page.locator('.mod-drawer .mod-seg', { hasText: 'LFO' }).click();
    await shot('move-lfo');
    await at('param:bars').locator('.param-mod').click();
    await title('The tempo');
    await at('dock:timeline').click();
    await type(at('bpm').locator('input'), 120);
    await title('On the beat');
    await at('param:speed').locator('.beat-clock').click();
    await title('A clip');
    await at('clip-add').click();
    await title('Automation');
    await at('automate').click();   // + Automate… loads the lanes; their own + Automate… picks one
    await at('automate').selectOption({ index: 1 });
    const lane = page.locator('.tl-auto-svg').first(), box = await lane.boundingBox();
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.3);
    await done();
    await shot('move-automate');
    await next();
    await finished(page, 'Movement and time', 'move');
    expect(errors).toEqual([]);
  });

  test('Colour', async ({ page, studio }, info) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const shot = shooter(page, info, 1366), { title, done, next, at } = steps(page);
    await fromTutorials(page, studio.origin, 'colour', 'Colour');
    await title('Find the colours');
    await at('layer:lighthouse').locator('.layer-name').click();
    await at('module:bars').click();
    await title('Pick colours');
    await at('param:colours').locator('.pick-btn').click();
    await page.locator('.pick-pop:popover-open .pick-cell[aria-label=accent1]').click();
    await shot('colour-pick');
    await page.keyboard.press('Escape');
    await title('The whole look');
    await at('dock:look').click();
    await title('The palette');
    await at('palette').locator('select').selectOption({ index: 2 });
    await done();
    await shot('colour-palette');
    await next();
    await finished(page, 'Colour', 'colour');
    expect(errors).toEqual([]);
  });

  test('Keep it, show it', async ({ page, studio }, info) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const shot = shooter(page, info, 1366), { title, done, next, at } = steps(page);
    await fromTutorials(page, studio.origin, 'keep', 'Keep it, show it');
    await title('Change something');
    await type(at('level:starfield').locator('input'), 70);
    await title('Step back');
    await at('history').click();
    await at('undo').click();
    await shot('keep-undo');
    await at('history').click();
    await title('Save');
    await at('save').click();
    await title('Live');
    await at('nav:live').click();
    await title('Describe an idea');
    await at('nav:ideas').click();
    await at('idea').fill('Slow embers rising up the spires');
    await done();
    await shot('keep-idea');
    await next();
    await finished(page, 'Keep it, show it', 'keep');
    expect(errors).toEqual([]);
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
