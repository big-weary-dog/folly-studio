// Looks from before the one rule (a warp bent the modules after it) converted so they render as they did
// (shared/chain-order.ts): each plan on its own, then every frozen look (test/fixtures/chains-v1.json, rendered by
// the old engine) byte for byte; rig-folly.test.js holds the Folly's composed look to its frozen bytes too.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import * as core from '../public/js/pattern-core.ts';
import { CHAIN, convertChain, convertLayers, touches, upgradeLook } from '../shared/chain-order.ts';
import { Layers } from '../shared/schemas/look.ts';
import { folly } from './fixtures/rigs.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const lib = (name) => read(`../public/patterns/${name}.js`);
const KINDS = Object.fromEntries(JSON.parse(read('../public/patterns/index.json')).map((e) => [e.name, e.kind]));
/** Library module `name` with id `id` (default: the name). */
const m = (name, extra = {}) => ({ id: name, kind: KINDS[name], title: name, ref: name, code: lib(name), params: {},
  ...extra });
/** A chain as ids (blend after a slash, `!` when off), the way the assertions read it. */
const order = (mods) => mods.map((x) => `${x.enabled === false ? '!' : ''}${x.id}${x.blend ? `/${x.blend}` : ''}`)
  .join(' ');
const convert = (mods) => { const r = convertChain(mods); return { ...r, order: order(r.modules) }; };

describe('touches: what a module reads of the pixel, from its code', () => {
  test('the library: fields by name, comments aside; attr and is read k', () => {
    assert.deepEqual([...touches(lib('hue-shift'), 'filter', 1)].sort(), ['a', 'lx', 'ly', 'lz', 'u']);
    assert.deepEqual([...touches(lib('mask'), 'filter', 1)], []);
    assert.deepEqual([...touches(lib('trails'), 'filter', 1)], ['k']);
    assert.deepEqual([...touches(lib('twist'), 'warp', 0)].sort(), ['a', 'lx', 'ly', 'lz', 'r']);
    assert.deepEqual([...touches('// q.x, q\nfunction pixel(q) { return q.is("rose") ? 1 : 0; }', 'pixel', 0)]
      .sort(), ['is', 'k']);
    assert.deepEqual([...touches('function filter(c) { return c; }', 'filter', 1)], []);
  });

  test('anything it cannot follow is any field', () => {
    for (const code of ['function pixel(p) { return f(p); }', 'function pixel(p) { const { lz } = p; return lz; }',
      'function pixel(p) { return g({ ...p }); }', 'const pixel = (p) => p.lz;',
      'function pixel({ lz }) { return lz; }', 'function pixel(p) { return p?.lz; }']) {
      assert.equal(touches(code, 'pixel', 0), null, code);
    }
    assert.deepEqual([...touches('function pixel(p, t) { return o.p + p.ly; }', 'pixel', 0)], ['ly']);
  });
});

describe('convertChain', () => {
  test('warps leading a stage move to its end, reversed; exact to the bit', () => {
    const r = convert([m('mirror'), m('twist'), m('plasma'), m('hue-shift'), m('mask')]);
    assert.equal(r.order, 'plasma hue-shift mask twist mirror');
    assert.equal(r.exact, true);
  });

  test('a stage after a blur or trails gets copies of the warps it read', () => {
    const r = convert([m('twist'), m('galaxy'), m('blur'), m('plasma'), m('trails'), m('hue-shift')]);
    assert.equal(r.order, 'galaxy twist blur plasma twist.2 trails hue-shift twist.3');
    assert.deepEqual(r.modules.filter((x) => x.ref === 'twist').map((x) => x.code), Array(3).fill(lib('twist')));
  });

  test('two sources bent differently turn over: the first goes under the second, or adds or maxes as it did', () => {
    assert.equal(convert([m('plasma'), m('twist'), m('galaxy', { blend: 'over' })]).order,
      'galaxy/over twist plasma/under');
    assert.equal(convert([m('plasma'), m('twist'), m('galaxy')]).order, 'galaxy twist plasma/add');
    assert.equal(convert([m('plasma', { blend: 'max' }), m('twist'), m('galaxy', { blend: 'max' })]).order,
      'galaxy/max twist plasma/max');
    // Hidden sources go with their run; each run takes only the warps between it and the run below.
    assert.equal(convert([m('plasma'), m('rotate'), m('galaxy', { blend: 'over' }), m('mirror'),
      m('clouds', { as: 'input' })]).order, 'clouds mirror galaxy/over rotate plasma/under');
  });

  test('otherwise a warp stop (a blur of radius 0) splits the stage, and the order stays', () => {
    for (const [mods, want] of [
      [[m('plasma'), m('twist'), m('galaxy', { blend: 'multiply' })], 'plasma stop galaxy/multiply twist'],
      [[m('bars'), m('mirror'), m('hue-shift')], 'bars stop hue-shift mirror'],
      [[m('clouds'), m('tint'), m('rotate'), m('lighthouse', { blend: 'max' })],
        'clouds tint stop lighthouse/max rotate'],
      [[m('blur', { id: 'b' }), m('plasma'), m('twist'), m('galaxy')], 'b plasma stop galaxy twist'],   // c not empty
    ]) {
      const r = convert(mods);
      assert.equal(r.order, want);
      const stop = r.modules.find((x) => x.id === 'stop');
      assert.ok(core.isStageEnd(stop) && core.compileModule(stop.code, 'filter').spatial === 'blur');
    }
  });

  test('a warp that bent nothing goes to the top of its stage; one that bent only a free op too', () => {
    assert.equal(convert([m('plasma'), m('mirror')]).order, 'mirror plasma');
    assert.equal(convert([m('meteors'), m('twist'), m('mask')]).order, 'twist meteors mask');   // they read no a, r, l*
  });

  test('disabled modules: a warp at the bottom of its stage, the rest after what was before them', () => {
    const off = { enabled: false };
    const r = convert([m('mirror', off), m('plasma'), m('tint', off), m('twist'), m('galaxy'), m('blur'),
      m('scroll', off), m('mask')]);
    assert.equal(r.order, 'galaxy twist plasma/add !tint !mirror blur mask !scroll');
    assert.equal(convert([m('bars'), m('tint', off), m('hue-shift'), m('mirror')]).order,
      'mirror bars !tint hue-shift');
  });

  test('a chain without warps is unchanged', () => {
    const mods = [m('meteors'), m('clouds', { as: 'input' }), m('mask', { input: 'clouds' }), m('trails')];
    assert.deepEqual(convertChain(mods), { modules: mods, exact: true });
  });

  test('over 8 modules, or a stage end reading a bent pixel: each warp at the end of its stage, not exact', () => {
    const long = convert([m('mirror'), m('twist'), m('rotate'), m('plasma'), m('blur'), m('galaxy'), m('trails'),
      m('bars')]);
    assert.equal(long.exact, false);
    assert.equal(long.order, 'plasma rotate twist mirror blur galaxy trails bars');
    const k = { id: 'k', kind: 'warp', code: 'function warp(q) { q.k = (q.k + 1) % 9; }' };
    assert.equal(convert([k, m('plasma'), m('trails')]).exact, false);
  });

  test('layers and looks: notes for what is not exact, a marked look left alone, the result a valid look', () => {
    const exact = { id: 'a', title: 'A', modules: [m('twist'), m('galaxy')] }, code = { id: 'c', code: lib('plasma') };
    const long = { id: 'b', title: 'Long', modules: [m('mirror'), m('twist'), m('rotate'), m('plasma'), m('blur'),
      m('galaxy'), m('trails'), m('bars')] };
    const { layers, notes } = convertLayers([exact, code, long]);
    assert.equal(layers[1], code);
    assert.deepEqual(notes, ['layer “Long”: its warps now bend all of their stage above them']);
    const { look, exact: ok } = upgradeLook({ title: 'L', summary: 'Storm.', layers: [exact, long] });
    assert.equal(ok, false);
    assert.equal(look.chain, CHAIN);
    assert.match(look.summary, /^Storm\. Warps now bend what is above them: layer “Long”/);
    assert.equal(upgradeLook(look).look.layers, look.layers);
    assert.ok(Layers.safeParse(look.layers).success);
  });
});

// Each frozen look, converted, renders the old engine's DMX bytes, frame for frame.
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);
function frames(look, count) {
  const scene = core.prepareScene(folly);
  core.setLibrary([]);
  const layers = look.layers.map((l) => core.prepareLayer(scene, l, core.compileLayer(l)));
  const g = core.prepareLook({ globals: look.globals, automation: look.automation, bpm: look.bpm });
  const rgb = new Float32Array(scene.count * 3), full = new Uint8Array(scene.frameChannels), out = [];
  for (let f = 0; f < count; f++) {
    const r = core.renderFrame(scene, layers, f / 40, rgb, g);
    assert.deepEqual(r.errors, []);
    out.push(sha(core.toChannels(scene, r.rgb, full)));
  }
  return out;
}

describe('frozen looks from before the rule render as they did, converted', () => {
  const fx = JSON.parse(read('./fixtures/chains-v1.json'));
  for (const { name, look, frames: want } of fx.looks) {
    test(name, () => {
      const layers = look.layers.map((l) => ({ ...l,
        modules: l.modules.map((x) => ({ ...x, code: fx.code[x.code] })) }));
      const { look: now, exact } = upgradeLook({ ...look, layers });
      assert.equal(exact, true);
      assert.ok(Layers.safeParse(now.layers).success, 'a valid look');
      assert.deepEqual(frames(now, fx.frames), want);
    });
  }
});
