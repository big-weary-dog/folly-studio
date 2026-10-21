// Spire rise's chapters after First look, played by their steps' own controls (tour.spec.js runs them): each step
// opens not yet done, rings its control inside the window with the card off the preview, and is done by the change
// it names.
import { expect } from './studio.js';

/** Type into a Scrub (or number) field and commit it. */
async function type(field, value) {
  await field.fill(String(value));
  await field.press('Enter');
}
/** A step: it opens, its control is ringed with the card off the preview, `act` does it, and it is done. */
async function step(t, title, names, act, shot) {
  await t.open(title);
  await t.ring(...names);
  await t.offPreview();
  await act();
  await t.done();
  if (shot) await t.shot(shot);
}
/** Open a colour param's picker, tick a palette role (in place of the whole palette), and close it. */
async function role(page, t, name) {
  await t.at('param:colours').locator('.pick-btn').click();
  const pop = page.locator('.pick-pop:popover-open');
  await pop.locator('.pick-whole', { hasText: new RegExp(`^${name}$`) }).locator('input').check();
  await page.keyboard.press('Escape');
}
/** + Add (or + Module), a shelf tab, an entry. */
async function shelf(t, add, tab, name) {
  await t.at(add).click();
  await t.at(`shelf-tab:${tab}`).click();
  await t.at(`shelf:${name}`).click();
}
/** ∿ on a param, a kind, then (for a macro) the macro, and close it. */
async function bind(page, t, param, kind, pick) {
  const mod = t.at(param).locator('.param-mod');
  await mod.click();
  await page.locator('.mod-drawer .mod-seg', { hasText: kind }).click();
  if (pick) await page.locator('.mod-drawer .mod-pick', { hasText: pick }).click();
  await mod.click();
}

export async function playColour(page, t) {
  await step(t, 'A module\'s colours', ['param:colours'], () => role(page, t, 'low'), 'colour-low');
  await step(t, 'The Look tab', ['dock:look'], () => t.at('dock:look').click());
  await step(t, 'The palette', ['palette'], () => t.at('palette').locator('select').selectOption('ocean'),
    'colour-palette');
  await t.next();
}

export async function playLayers(page, t) {
  await step(t, 'A new layer from a source', ['layers-add'], () => shelf(t, 'layers-add', 'blank', 'bars'),
    'layers-bars');
  await step(t, 'Its colours', ['param:colours'], () => role(page, t, 'high'), 'layers-high');
  await step(t, 'Where it plays', ['plays-on'], async () => {
    await t.at('plays-on').click();
    await page.locator('#grp-cathedral').uncheck();
    await page.locator('#grp-spires').check();
    await t.ring('plays-on', 'group:spires');
    await t.at('plays-on').click();
  }, 'layers-spires');
  await step(t, 'A camera view', ['view-bar', 'view:spire'], () => t.at('view:spire').click(), 'layers-view');
  await step(t, 'Zoom in', ['preview'], async () => {
    const box = await t.at('preview').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600);
  }, 'layers-zoom');
  await step(t, 'Solo', ['solo:bars'], () => t.at('solo:bars').click(), 'layers-solo');
  await step(t, 'A choice', ['param:profile'], () => t.at('param:profile').locator('select').selectOption('comet'),
    'layers-comet');
  await step(t, 'A warp', ['chain-add'], () => shelf(t, 'chain-add', 'warp', 'twist'), 'layers-warp');
  await step(t, 'A warp\'s setting', ['module:twist', 'param:wind'],
    () => type(t.at('param:wind').locator('input').first(), 0.6), 'layers-wind');
  await step(t, 'A filter', ['chain-add'], () => shelf(t, 'chain-add', 'filter', 'trails'), 'layers-filter');
  await step(t, 'On and off', ['module-on:twist'], async () => {
    await t.at('module-on:twist').click();
    await expect(t.at('module-on:twist')).not.toBeChecked();
    await t.at('module-on:twist').click();
  });
  await step(t, 'Soften', ['soften'], () => type(t.at('soften').locator('input').first(), 45), 'layers-soften');
  await step(t, 'Solo off', ['solo:bars'], () => t.at('solo:bars').click(), 'layers-unsolo');
  await step(t, 'Level', ['level:bars'], () => type(t.at('level:bars').locator('input'), 65), 'layers-level');
  await step(t, 'Blend', ['blend:bars'], () => t.at('blend:bars').selectOption('over'), 'layers-blend');
  await step(t, 'A third layer', ['layers-add'], () => shelf(t, 'layers-add', 'blank', 'sparkle'), 'layers-sparkle');
  await step(t, 'Order', ['move-layer-down'], () => t.at('move-layer-down').click(), 'layers-order');
  await t.next();
}

export async function playMove(page, t) {
  await step(t, 'Focus', ['solo:bars'], () => t.at('solo:bars').click(), 'move-focus');
  await step(t, 'Close in', ['view-bar', 'view:spire'], () => t.at('view:spire').click(), 'move-view');
  await step(t, 'Pause and play', ['play'], async () => {
    await t.at('play').click();
    await expect(t.at('play')).toHaveAttribute('aria-label', 'Play');
    await t.at('play').click();
  });
  await step(t, 'The tempo', ['dock:timeline', 'bpm'], async () => {
    await t.at('dock:timeline').click();
    await t.ring('dock:timeline', 'bpm');
    await type(t.at('bpm').locator('input'), 90);
  }, 'move-bpm');
  await step(t, 'On the beat', ['layer:bars', 'param:speed'], () => t.at('param:speed').locator('.beat-clock').click(),
    'move-clock');
  await step(t, 'A value that moves', ['layer:bars', 'param:duty'], () => bind(page, t, 'param:duty', 'LFO'),
    'move-lfo');
  await step(t, 'The whole building', ['solo:bars'], async () => {
    await t.at('solo:bars').click();
    await t.ring('view-bar', 'view:fit');
    await t.at('view:fit').click();
  }, 'move-whole');
  await step(t, 'A macro', ['dock:look', 'macro-add'], async () => {
    await t.at('dock:look').click();
    await t.ring('dock:look', 'macro-add');
    await t.at('macro-add').click();
  });
  await step(t, 'Tie a value to it', ['layer:sparkle', 'param:density'], async () => {
    await t.at('layer:sparkle').locator('.layer-name').click();
    await t.ring('layer:sparkle', 'param:density');
    await bind(page, t, 'param:density', 'Macro', 'macro1');
  }, 'move-tie');
  await step(t, 'Automation', ['dock:timeline', 'automate'], async () => {
    await t.at('dock:timeline').click();
    await t.at('automate').click();   // + Automate… loads the lanes; their own + Automate… picks one
    await t.ring('dock:timeline', 'automate');
    await t.at('automate').selectOption({ index: 1 });
    const lane = page.locator('.tl-auto-svg').first(), box = await lane.boundingBox();
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.8);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.2);
  }, 'move-automate');
  await step(t, 'A clip', ['layer:bars', 'clip-add'], async () => {
    await t.at('layer:bars').locator('.layer-name').click();
    await t.ring('layer:bars', 'clip-add');
    await t.at('clip-add').click();
  }, 'move-clip');
  await t.next();
}

export async function playKeep(page, t) {
  await step(t, 'Try an idea', ['layer:bars', 'plays-on'], async () => {
    await t.at('plays-on').click();
    await page.locator('#grp-cathedral').check();
    await t.at('plays-on').click();
  }, 'keep-try');
  await step(t, 'Undo', ['history', 'undo'], async () => {
    await t.at('history').click();
    await t.ring('history', 'undo');
    await t.at('undo').click();
  }, 'keep-undo');
  await t.at('history').click();
  await step(t, 'Save', ['save'], () => t.at('save').click());
  await step(t, 'Live', ['nav:live'], () => t.at('nav:live').click());
  await t.open('Describe an idea');
  await t.at('nav:ideas').click();
  await t.ringAt('idea');
  await t.at('idea').fill('Dawn over the spires: the bed warms to gold and the bars slow down');
  await t.done();
  await t.shot('keep-idea');
  await t.next();
}
