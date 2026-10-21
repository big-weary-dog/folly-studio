// Composed looks over the API and from generators: module chains, globals (a palette by name filled in) and
// automation are validated strictly by the API and leniently by generators; old single-code layers stay valid;
// chains from before the one rule are converted on their way in, and once at start.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { validateLook } from '../shared/schemas/generated.ts';
import { layersHash, renderFields } from '../src/bake.ts';
import { fakeBox, fx, PIXEL, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const WARP = 'function warp(q) { q.lz = 1 - q.lz; }';
const FILTER = 'function filter(c, q, t, P, G, x) { return x || c; }';
const chain = (extra = {}) => ({ id: 'l1', title: 'Chain', groups: ['cathedral'], modules: [
  { id: 'a', kind: 'source', title: 'A', ref: 'streaks', code: PIXEL, params: { speed: { mod: 'lfo', rate: 2 } } },
  { id: 'b', kind: 'source', title: 'B', code: PIXEL, as: 'input' },
  { id: 'f', kind: 'filter', title: 'Mask', code: FILTER, input: 'b',
    params: { k: { mod: 'global', name: 'storm', from: 0, to: 1 } } },
  { id: 'w', kind: 'warp', title: 'Flip', code: WARP },
], ...extra });
// A chain from before the one rule: the flip bent the source after it.
const OLD = { id: 'l1', title: 'Flip', groups: ['cathedral'], modules: [{ id: 'w', kind: 'warp', code: WARP },
  { id: 's', kind: 'source', code: 'function pixel(p) { return [p.lz, 0, 0]; }' }] };
const ids = (layers) => layers[0].modules.map((m) => m.id);
const GLOBALS = { energy: 0.7, palette: 'carnival', macros: { storm: { value: 0.25 } } };

describe('composed looks over the API', () => {
  let app, ana;
  beforeAll(async () => {
    app = await startApp({ dataDir: path.join(fx.tmp, 'data-compose'), publicDir: PUBLIC, renderBox: fakeBox() });
    ana = await signup(app, 'compose-ana');
  });
  afterAll(() => app.close());

  test('a chain, globals and automation are stored, a palette name filled in', async () => {
    const r = await ana.post('/api/looks', { title: 'Storm', layers: [chain()], globals: GLOBALS, chain: 2,
      automation: { energy: [[10, 1], [0, 0.2]], storm: [[0, 0]] } });
    assert.equal(r.status, 201, r.text);
    const look = r.json.look;
    assert.deepEqual(look.layers[0].modules.map((m) => [m.id, m.kind]), [['a', 'source'], ['b', 'source'],
      ['f', 'filter'], ['w', 'warp']]);
    assert.equal('code' in look.layers[0], false);
    assert.deepEqual(look.layers[0].modules[0].params.speed, { mod: 'lfo', rate: 2 });
    assert.equal(look.globals.palette.name, 'carnival');
    assert.deepEqual(look.globals.palette.low, ['#6700cb', '#b500b0']);
    assert.deepEqual(look.globals.macros, { storm: { value: 0.25, min: 0, max: 1 },
      energy: { value: 0.7, min: 0, max: 1 } }, 'an old look\'s energy is a macro');
    assert.deepEqual(look.automation.energy, [[0, 0.2], [10, 1]], 'sorted by time');
    const old = await ana.post('/api/looks', { title: 'Old', layers: [{ code: PIXEL, params: { k: 1 } }] });
    assert.equal(old.status, 201, 'single-code layers stay valid');
    const graded = await ana.post('/api/looks', { title: 'Graded', layers: [chain()],
      globals: { speed: 9, level: 0.2, hue: 3, saturation: 0, live: ['level', 'bpm'] },
      automation: { hue: [[0, 1]] } });
    assert.equal(graded.status, 201, 'an old look\'s speed, level, hue and saturation are ignored');
    assert.deepEqual(graded.json.look.globals ?? {}, { live: ['bpm'] });
    assert.deepEqual(graded.json.look.automation ?? {}, {});
  });

  test('bad chains, globals and automation are refused with a reason', async () => {
    const m = (patch) => chain({ modules: [{ ...chain().modules[0], ...patch }] });
    const bads = [
      [{ layers: [m({ kind: 'effect' })] }, /kind must be one of/],
      [{ layers: [chain({ modules: [chain().modules[0], chain().modules[0]] })] }, /id must be unique/],
      [{ layers: [chain({ code: PIXEL })] }, /modules or code/],
      [{ layers: [m({ as: 'output' })] }, /as is only 'input'/],
      [{ layers: [m({ params: { v: { mod: 'lfo', shape: 'wobble' } } })] }, /unsupported value/],
      [{ layers: [chain({ modules: [] })] }, /1–8 modules/],
      [{ layers: [chain()], globals: { tempo: 1 } }, /not a global/],
      [{ layers: [chain()], globals: { palette: 'plaid' } }, /no palette called plaid/],
      [{ layers: [chain()], globals: { macros: { bpm: {} } } }, /Macro bpm/],
      [{ layers: [chain()], globals: { macros: { constructor: {} } } }, /Macro constructor/],
      [{ layers: [chain()], automation: { storm: [[0, 1]] } }, /automate one of the look's macros/],
      [{ layers: [chain()], globals: GLOBALS, automation: { storm: [[0, 1], [0, 0]] } }, /two points at 0 s/],
      [{ layers: [chain()], globals: GLOBALS, automation: { storm: [[0, 2]] } }, /each point is/],
    ];
    for (const [body, why] of bads) {
      const r = await ana.post('/api/looks', { title: 'x', ...body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match(r.json.error, why);
    }
  });

  test('changing globals or automation makes a version; null clears them', async () => {
    const { look } = (await ana.post('/api/looks', { title: 'V', layers: [chain()], globals: GLOBALS })).json;
    const put = (body) => ana.put(`/api/looks/${look.id}?versions=1`, body);
    let r = await put({ globals: { ...GLOBALS, energy: 0.1 } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.look.versionCount, 1);
    assert.equal(r.json.look.versions[0].globals.macros.energy.value, 0.7, 'the version keeps the old globals');
    r = await put({ automation: { storm: [[0, 0.5]] } });
    assert.deepEqual(r.json.look.automation, { storm: [[0, 0.5]] });
    assert.equal(r.json.look.versionCount, 2);
    assert.equal((await put({ globals: { energy: 0.1 } })).status, 400, 'its lanes must still name a macro');
    r = await put({ globals: null, automation: null });
    assert.equal(r.status, 200, r.text);
    assert.equal('globals' in r.json.look || 'automation' in r.json.look, false);
    assert.equal((await put({ globals: null })).json.look.versionCount, 3, 'clearing nothing changes nothing');
  });

  test('a chain without `chain: 2` is converted to the one rule on its way in; with it, kept as sent', async () => {
    let r = await ana.post('/api/looks', { title: 'Old', layers: [OLD] });
    assert.deepEqual([ids(r.json.look.layers), r.json.look.chain], [['s', 'w'], 2]);
    const put = (body) => ana.put(`/api/looks/${r.json.look.id}`, body);
    assert.deepEqual(ids((await put({ layers: [OLD] })).json.look.layers), ['s', 'w']);
    assert.deepEqual(ids((await put({ layers: [OLD], chain: 2 })).json.look.layers), ['w', 's']);
    r = await ana.post('/api/looks', { title: 'X', layers: [OLD], chain: 1 });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /chain must be 2/);
  });

  test('the library lists each entry\'s kind and category, and a preset\'s layers', async () => {
    const { patterns } = (await ana.get('/api/library')).json;
    const byName = new Map(patterns.map((p) => [p.name, p]));
    assert.deepEqual(['streaks', 'mirror', 'mask'].map((n) => byName.get(n).kind), ['source', 'warp', 'filter']);
    assert.ok(patterns.every((p) => p.category && typeof p.code === 'string'));
    assert.equal(byName.get('palette-drift').layers[0].modules[0].ref, 'colour-wash');
  });
});

test('looks stored before the rule are converted once at start: their versions too; an exact bake stays', async () => {
  const dataDir = path.join(fx.tmp, 'data-before');
  await mkdir(dataDir, { recursive: true });
  const at = '2025-01-01T00:00:00.000Z', bake = { source: 'render-box', status: 'done', ok: true,
    layersHash: layersHash(renderFields({ layers: [OLD] })) };
  await writeFile(path.join(dataDir, 'looks.json'), JSON.stringify([{ id: 'old', owner: 'u1', title: 'Old',
    layers: [OLD], versions: [{ layers: [OLD], savedAt: at }], bake, reviewed: true, shared: true, createdAt: at,
    updatedAt: at }]));
  const app = await startApp({ dataDir, publicDir: PUBLIC, renderBox: fakeBox() });
  const { look } = (await (await signup(app, 'before-bo')).get('/api/looks/old')).json;
  assert.deepEqual([ids(look.layers), look.chain, look.updatedAt, look.reviewed], [['s', 'w'], 2, at, true]);
  assert.equal(look.bake.layersHash, layersHash(renderFields(look)), 'the same frames: the bake still holds');
  await app.close();
  const [stored] = JSON.parse(await readFile(path.join(dataDir, 'looks.json'), 'utf8'));
  assert.deepEqual([ids(stored.layers), ids(stored.versions[0].layers), stored.chain], [['s', 'w'], ['s', 'w'], 2]);
});

test('renderFields: plain layers unless something else plays', () => {
  const layers = [chain()];
  assert.equal(renderFields({ layers, bpm: 120 }), layers, 'the hash of older looks is unchanged');
  assert.deepEqual(renderFields({ layers, globals: { energy: 1 } }), { layers, globals: { energy: 1 }, automation: null,
    bpm: null });
  const beats = [{ code: PIXEL, params: { v: { mod: 'lfo', unit: 'beats' } } }];
  assert.equal(renderFields({ layers: beats, bpm: 90 }).bpm, 90, 'an LFO in beats plays at the look\'s tempo');
});

describe('generated chains', () => {
  const library = [{ name: 'clouds', kind: 'source', code: PIXEL }, { name: 'mask', kind: 'filter', code: FILTER }];
  const groups = [{ id: 'spires' }];

  test('modules, globals and automation are kept, cleaned, and held to the API\'s rules', () => {
    const look = validateLook({ title: 'Storm', summary: 'x', layers: [{ title: 'L', groups: ['spires'], modules: [
      { id: 'met', kind: 'source', title: 'Meteors', code: PIXEL },
      { id: 'cl', kind: 'source', title: 'Clouds', ref: 'clouds', code: PIXEL, as: 'input' },
      { kind: 'filter', title: 'Mask', ref: 'mask', code: FILTER, input: 'cl' },
      { kind: 'filter', title: 'Broken', code: 'function pixel() {}' },
    ] }], globals: { palette: 'Carnival', macros: [{ name: 'storm', value: 0.5 }, { name: 'energy', value: 0.4 },
      { name: 'bpm' }] },
    automation: [{ name: 'energy', points: [[5, 1], [0, 0], [5, 0.3]] }, { name: 'tempo', points: [[0, 1]] }] },
    { groups, library });
    const mods = look.layers[0].modules;
    assert.deepEqual(mods.map((m) => m.id), ['met', 'cl', 'm3']);
    assert.equal(mods[2].input, 'cl');
    assert.equal(mods[1].ref, 'clouds');
    assert.equal(look.globals.palette.name, 'carnival');
    assert.deepEqual(Object.keys(look.globals.macros), ['storm', 'energy']);
    assert.deepEqual(look.automation, { energy: [[0, 0], [5, 1]] });
    assert.ok(look.dropped.some((d) => /module 4: code does not define function filter/.test(d)), look.dropped.join());
    assert.ok(look.dropped.some((d) => /bpm/.test(d)), look.dropped.join());
    assert.ok(look.dropped.some((d) => /tempo/.test(d)));
  });

  test('old single-code layers still pass; a chain with no source is dropped', () => {
    const look = validateLook({ title: 'Old', layers: [{ title: 'A', code: PIXEL, params: { k: 1 } },
      { title: 'B', modules: [{ kind: 'warp', code: WARP }] }] }, { groups, library });
    assert.deepEqual(look.layers.map((l) => [l.title, l.code === PIXEL]), [['A', true]]);
    assert.equal('globals' in look || 'automation' in look, false);
    assert.match(look.dropped.join(), /no usable source module/);
  });
});
