// Rose and arches' chapters after Getting around, played by their steps' own controls (tour.spec.js runs them): each
// step opens not yet done, rings its control inside the window with the card off the preview, and is done by the
// change it names.
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
/** Select a layer, then (when given) open one of its modules, each once ringed, till `param` is ringed. */
async function pick(t, layer, module, param) {
  await t.at(`layer:${layer}`).locator('.layer-name').click();
  if (!module) return;
  await t.ring(`module:${module}`, param);
  if (!await t.at(param).isVisible()) await t.at(`module:${module}`).click();
  await t.ring(param);
}
/** Open a colour param's picker, tick a palette role (in place of the whole palette), and close it. */
async function role(page, t, name) {
  await t.at('param:colours').locator('.pick-btn').click();
  const pop = page.locator('.pick-pop:popover-open');
  await pop.locator('.pick-whole', { hasText: new RegExp(`^${name}$`) }).locator('input').check();
  await page.keyboard.press('Escape');
}
/** + Add (or + Module), a shelf tab, an entry. The camera snaps back from the shelf's framing (reduced motion, for
 * the pick only) rather than easing for longer than the step stays, so its shot shows the view it asks for. */
async function shelf(t, add, tab, name) {
  await t.at(add).click();
  await t.at(`shelf-tab:${tab}`).click();
  const page = t.card.page();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await t.at(`shelf:${name}`).click();
  await expect(page.locator('dialog.shelf-dialog')).toHaveCount(0);
  await page.waitForTimeout(100);   // the view goes back as the shelf closes
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}
/** The ∿ beside a param: opens or closes its drawer (dispatched: a step done meanwhile may have put its card over
 * it). */
const drawer = (t, param) => t.at(param).locator('.param-mod').dispatchEvent('click');
/** In the open ∿ drawer: a button (a kind, a shape, a macro) by its text. */
const seg = (page, text) => page.locator('.mod-drawer').locator('.mod-seg, .mod-pick', { hasText: text }).first()
  .click();
/** In the open ∿ drawer: a number by its label. */
const num = (page, label, value) => page.locator(`.mod-drawer input[aria-label="${label}"]`).fill(String(value));

export async function playIdea(page, t) {
  await step(t, 'Describe it', ['idea'], () => t.at('idea')
    .fill('The rose window blooms open ring by ring while light runs up the main arches.'), 'idea-describe');
  await t.open('Make it');
  await t.ring('idea-make');
  await t.at('idea-make').click();
  await expect(t.card).toHaveClass(/done/, { timeout: 30_000 });
  await t.shot('idea-make');
  await step(t, 'What it made', ['layer:arches'], () => pick(t, 'arches'), 'idea-layer');
  await step(t, 'See it close', ['view-bar', 'view:rose'], () => t.at('view:rose').click(), 'idea-close');
  await t.next();
}

export async function playModules(page, t) {
  await step(t, 'A number', ['layer:arches'], async () => {
    await pick(t, 'arches');
    await t.ring('param:speed');
    await type(t.at('param:speed').locator('input').first(), 6);
  }, 'modules-speed');
  await step(t, 'A choice', ['param:profile'], () => t.at('param:profile').locator('select').selectOption('comet'),
    'modules-comet');
  await step(t, 'A colour', ['param:colours'], () => role(page, t, 'high'), 'modules-high');
  await step(t, 'The Look tab', ['dock:look'], () => t.at('dock:look').click(), 'modules-look');
  await step(t, 'The palette', ['palette'], () => t.at('palette').locator('select').selectOption('ocean'),
    'modules-palette');
  await t.next();
}

export async function playLayers(page, t) {
  await step(t, 'Solo', ['solo:rose'], () => t.at('solo:rose').click(), 'layers-solo');
  await step(t, 'A filter', ['chain-add'], () => shelf(t, 'chain-add', 'filter', 'stained-glass'), 'layers-filter');
  await step(t, 'A filter\'s choice', ['module:stained-glass', 'param:rule'], async () => {
    await t.at('module:stained-glass').click();
    await t.at('param:rule').locator('select').selectOption('spiral');
  }, 'layers-rule');
  await step(t, 'On and off', ['module-on:stained-glass'], async () => {
    await t.at('module-on:stained-glass').click();
    await expect(t.at('module-on:stained-glass')).not.toBeChecked();
    await t.at('module-on:stained-glass').click();
  }, 'layers-onoff');
  await step(t, 'Solo another', ['solo:rose'], async () => {
    await t.at('solo:rose').click();
    await t.ring('solo:arches');
    await t.at('solo:arches').click();
  }, 'layers-swap');
  await step(t, 'A warp', ['layer:arches'], async () => {
    await pick(t, 'arches');
    await t.ring('chain-add');
    await shelf(t, 'chain-add', 'warp', 'rotate');
  }, 'layers-warp');
  await step(t, 'A warp\'s number', ['module:rotate', 'param:angle'], async () => {
    await t.at('module:rotate').click();
    await type(t.at('param:angle').locator('input').first(), 0.3);
  }, 'layers-angle');
  await step(t, 'Soften', ['soften'], () => type(t.at('soften').locator('input').first(), 45), 'layers-soften');
  await step(t, 'Where it plays', ['plays-on'], async () => {
    await t.at('plays-on').click();
    await t.ring('plays-on', 'group:mini-arches');
    await page.locator('#grp-mini-arches').check();
  }, 'layers-plays');
  await t.at('plays-on').dispatchEvent('click');
  await step(t, 'Solo off', ['solo:arches'], () => t.at('solo:arches').click(), 'layers-unsolo');
  await step(t, 'A preset', ['layers-add'], () => shelf(t, 'layers-add', 'preset', 'starfield'), 'layers-preset');
  await step(t, 'Inside a preset', ['module:sparkle'], async () => {
    await t.at('module:sparkle').click();
    await t.ring('param:density');
    await type(t.at('param:density').locator('input').first(), 0.95);
  }, 'layers-inside');
  await step(t, 'Level', ['level:starfield'], () => type(t.at('level:starfield').locator('input'), 40),
    'layers-level');
  await step(t, 'Blend', ['blend:starfield'], () => t.at('blend:starfield').selectOption('over'), 'layers-blend');
  await step(t, 'Order', ['move-layer-down'], () => t.at('move-layer-down').click(), 'layers-order');
  await step(t, 'Mute', ['mute:starfield'], async () => {
    await t.at('mute:starfield').click();
    await expect(t.at('mute:starfield')).toHaveAttribute('aria-pressed', 'true');
    await t.at('mute:starfield').click();
  }, 'layers-mute');
  await t.next();
}

export async function playTime(page, t) {
  await step(t, 'The tempo', ['dock:timeline', 'bpm'], async () => {
    await t.at('dock:timeline').click();
    await t.ring('dock:timeline', 'bpm');
    await type(t.at('bpm').locator('input'), 90);
  }, 'time-bpm');
  await step(t, 'On the beat', ['layer:arches'], async () => {
    await pick(t, 'arches', 'single-strand', 'param:speed');
    await t.ring('param:speed');
    await t.at('param:speed').locator('.beat-clock').click();
  }, 'time-clock');
  await step(t, 'A clip', ['clip-add'], () => t.at('clip-add').click(), 'time-clip');
  await t.next();
}

export async function playMoves(page, t) {
  await step(t, 'An LFO', ['layer:starfield'], async () => {
    await pick(t, 'starfield', 'colour-wash', 'param:brightness');
    await t.ring('param:brightness');
    await drawer(t, 'param:brightness');
    await t.ring('mod-kinds');
    await seg(page, 'LFO');
  }, 'moves-lfo');
  await step(t, 'Its rate', ['mod-rate'], () => num(page, 'Beats a cycle', 16), 'moves-rate');
  await step(t, 'Its range', ['mod-between'], () => num(page, 'To', 0.85), 'moves-between');
  await drawer(t, 'param:brightness');
  await step(t, 'A square wave', ['layer:rose'], async () => {
    await pick(t, 'rose', 'stained-glass', 'param:amount');
    await t.ring('param:amount');
    await drawer(t, 'param:amount');
    await seg(page, 'LFO');
    await t.ring('mod-shape');
    await seg(page, 'square');
  }, 'moves-square');
  await step(t, 'All the way off', ['mod-between'], () => num(page, 'From', 0), 'moves-off');
  await drawer(t, 'param:amount');
  await step(t, 'A saw wave', ['layer:arches'], async () => {
    await pick(t, 'arches', 'rotate', 'param:angle');
    await drawer(t, 'param:angle');
    await seg(page, 'LFO');
    await t.ring('mod-shape');
    await seg(page, 'saw');
  }, 'moves-saw');
  await drawer(t, 'param:angle');
  await step(t, 'A macro', ['dock:look', 'macro-add'], async () => {
    await t.at('dock:look').click();
    await t.ring('dock:look', 'macro-add');
    await t.at('macro-add').click();
  }, 'moves-macro');
  await step(t, 'Tie a value to it', ['module:single-strand'], async () => {
    await t.at('module:single-strand').click();
    await t.ring('param:tail');
    await drawer(t, 'param:tail');
    await t.ring('mod-kinds');
    await seg(page, 'Macro');
  }, 'moves-tail');
  await drawer(t, 'param:tail');
  await step(t, 'Tie another', ['layer:rose'], async () => {
    await pick(t, 'rose', 'bars', 'param:bars');
    await drawer(t, 'param:bars');
    await t.ring('mod-kinds');
    await seg(page, 'Macro');
  }, 'moves-rings');
  await drawer(t, 'param:bars');
  await step(t, 'Move the fader', ['dock:look', 'macro:macro1'], async () => {
    await t.at('dock:look').click();
    await t.ring('macro:macro1');
    await type(t.at('macro:macro1').locator('.field-control input').first(), 1);
  }, 'moves-fader');
  await step(t, 'Automation', ['dock:timeline', 'automate'], async () => {
    await t.at('dock:timeline').click();
    await t.at('automate').click();   // + Automate… loads the lanes; their own + Automate… picks one
    await t.ring('dock:timeline', 'automate');
    await t.at('automate').selectOption({ index: 1 });
    const lane = page.locator('.tl-auto-svg').first(), box = await lane.boundingBox();
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.8);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.2);
  }, 'moves-automate');
  await t.next();
}

export async function playKeep(page, t) {
  await step(t, 'Try an idea', ['layer:arches'], async () => {
    await pick(t, 'arches');
    await t.ring('plays-on');
    await t.at('plays-on').click();
    await page.locator('#grp-cathedral').check();
  }, 'keep-try');
  await t.at('plays-on').dispatchEvent('click');
  await step(t, 'Undo', ['history', 'undo'], async () => {
    await t.at('history').click();
    await t.ring('history', 'undo');
    await t.at('undo').click();
  }, 'keep-undo');
  await t.at('history').dispatchEvent('click');
  await step(t, 'Save', ['save'], () => t.at('save').click(), 'keep-save');
  await step(t, 'Live', ['nav:live'], () => t.at('nav:live').click(), 'keep-live');
  await t.next();
}
