// Pictures (SPEC-library "Pictures"): the core's check, the param kind through compile and resolve, the picture
// source on the rose, the look's schema, expansion from a composition and the Studio's row.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { describe, test } from 'vitest';

import {
  compileLayer, normalizeParams, pictureProblem, prepareLayer, prepareLook, prepareScene, readPicture, renderFrame,
  resolveParams,
} from '../public/js/pattern-core.ts';
import { normaliseParam } from '../public/js/ui/bindings.ts';
import { keyColour } from '../public/js/ui/picture-row.tsx';
import { buildCatalog } from '../src/generate/catalog.ts';
import { expand } from '../src/generate/expand.ts';
import { STUDIO } from './fixtures/generate/shared.js';

const read = (f) => fs.readFileSync(path.join(STUDIO, f), 'utf8');
const RIG = JSON.parse(read('public/data/rig.json')), CODE = read('public/patterns/picture.js');
const PALETTES = JSON.parse(read('public/data/palettes.json')).palettes;
const pic = (rows, extra = {}) => ({ grid: 'rose', key: { r: '#ff0000', g: '#00ff00', b: 'accent 50%' },
  frames: [{ rows }], ...extra });

describe('the core', () => {
  test('a picture within its limits is read and frozen; anything else names its problem', () => {
    const p = readPicture(pic(['r', 'g.b']));
    assert.deepEqual(p, { grid: 'rose', repeat: 1, key: { r: '#ff0000', g: '#00ff00', b: 'accent 50%' },
      frames: [{ rows: ['r', 'g.b'], hold: 1 }] });
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.frames[0].rows));
    const bad = {
      'grid is rose or square.': pic([], { grid: 'hex' }),
      'repeat is a whole number from 1 to 16.': pic([], { repeat: 17 }),
      'frame 1: "x" is not in the key.': pic(['rx']),
      'key "." is not one character (or is . clear).': pic([], { key: { '.': 'body' } }),
      'frames is a list of 1 to 16.': pic([], { frames: [] }),
      'frame 1: a row is text of at most 128.': pic(['r'.repeat(129)]),
    };
    for (const [why, v] of Object.entries(bad)) assert.equal(pictureProblem(v), why);
    assert.match(pictureProblem(pic([], { key: { r: 'crimson' } })), /not a palette colour/);
    const full = () => ({ rows: Array(128).fill('r'.repeat(128)) });
    assert.equal(pictureProblem(pic([], { grid: 'square', frames: [full()] })), '', 'one 128 by 128 frame fits');
    assert.match(pictureProblem(pic([], { frames: Array.from({ length: 2 }, full) })), /at most 32768/);
    assert.equal(readPicture('rgb'), null);
  });

  test('a picture param: declared, overridden, and a bad override keeps the default', () => {
    const schema = normalizeParams({ p: { type: 'picture', value: pic(['r']) }, e: { type: 'picture' } });
    assert.equal(schema.p.type, 'picture');
    assert.deepEqual(schema.e.value.frames, [{ rows: [], hold: 1 }]);
    assert.throws(() => normalizeParams({ p: { type: 'picture', value: { grid: 'x' } } }), /param "p": grid is/);
    assert.deepEqual(resolveParams(schema, { p: pic(['g']) }).p.frames[0].rows, ['g']);
    assert.equal(resolveParams(schema, { p: 'nope' }).p, schema.p.value);
  });
});

describe('the picture source on the rose', () => {
  const scene = prepareScene(RIG), rose = scene.groups.find((g) => g.id === 'rose-window');
  const leds = [...Array(scene.count).keys()].filter((k) => scene.attrs?.ring?.[k] > 0 || RIG.pixels.attrs.ring[k] > 0);
  /** Each rose LED's [r, g, b] at t, with the picture param `p` and the palette by name. */
  function draw(p, { t = 0, speed = 4, palette = 'chapel' } = {}) {
    const layer = { id: 'l', groups: [rose.id], modules: [{ id: 'm', kind: 'source', code: CODE,
      params: { picture: p, speed } }] };
    const L = prepareLayer(scene, layer, compileLayer(layer));
    const look = prepareLook({ globals: { palette: PALETTES.find((x) => x.name === palette) } });
    const out = renderFrame(scene, [L], t, null, look);
    assert.deepEqual(out.errors, []);
    return (k) => [0, 1, 2].map((c) => Math.round(out.rgb[k * 3 + c] * 255));
  }
  const ring = (k) => RIG.pixels.attrs.ring[k], petal = (k) => RIG.pixels.attrs.sector[k];

  test('a rose grid: a row a ring, one character a whole ring; repeat 16 makes a row each petal', () => {
    const at = draw(pic(['r', '', 'g']));
    for (const k of leds) {
      assert.deepEqual(at(k), ring(k) === 1 ? [255, 0, 0] : ring(k) === 3 ? [0, 255, 0] : [0, 0, 0], `LED ${k}`);
    }
    const sides = draw(pic(['', '', '', '', 'rgr'], { repeat: 16 }));
    const five = leds.filter((k) => ring(k) === 5 && petal(k) === 0).map(sides);
    assert.deepEqual(five, [[255, 0, 0], [0, 255, 0], [255, 0, 0]], 'left, middle, right of a petal');
  });

  test('16 characters round once are the petals, the top first; palette keys follow the palette', () => {
    const row = `b${'.'.repeat(15)}`, chapel = draw(pic([row])), ember = draw(pic([row]), { palette: 'ember' });
    const at = (n) => leds.find((k) => ring(k) === 1 && petal(k) === n), top = at(0), next = at(1);
    assert.deepEqual(chapel(top), [21, 29, 128], 'accent1 of chapel at 50 %');
    assert.notDeepEqual(ember(top), chapel(top));
    assert.deepEqual(chapel(next), [0, 0, 0]);
  });

  test('a square grid lies flat; frames play at speed, each for its hold', () => {
    const half = { grid: 'square', key: { r: '#ff0000' },
      frames: [{ rows: ['rr', '..'], hold: 2 }, { rows: ['..', 'rr'] }] };
    const lit = (at) => leds.filter((k) => at(k)[0] > 0).map((k) => scene.Y[k]);
    const mid = rose.centre[1];
    const first = lit(draw(half, { t: 0.4, speed: 4 })), then = lit(draw(half, { t: 0.6, speed: 4 }));
    assert.ok(first.length > 50 && first.every((y) => y > mid - 0.3), 'frame 1: the top half');
    assert.ok(then.length > 50 && then.every((y) => y < mid + 0.3), 'frame 2 after two ticks: the bottom half');
  });
});

describe('looks, generators and the Studio', () => {
  test('expansion makes the wire\'s key list an object, and a broken picture is an error to repair', () => {
    const catalog = buildCatalog([{ name: 'picture', kind: 'source', title: 'Picture', code: CODE }]);
    assert.equal(catalog.modules.get('picture').params.picture.type, 'picture');
    const wire = { grid: 'rose', key: [{ char: 'r', colour: 'body' }], frames: [{ rows: ['r'] }] };
    const look = (v) => expand({ title: 'T', summary: 'S', layers: [{ title: 'L', groups: ['rose-window'],
      blend: 'add', level: 1, modules: [{ use: 'picture', params: [{ name: 'picture', value: v }] }] }] }, catalog);
    const ok = look(wire);
    assert.deepEqual(ok.errors, []);
    assert.deepEqual(ok.look.layers[0].modules[0].params.picture.key, { r: 'body' });
    assert.deepEqual(look({ ...wire, frames: [{ rows: ['q'] }] }).errors, [{
      path: 'layers[0].modules[0].params.picture', code: 'bad_picture', message: 'frame 1: "q" is not in the key.' }]);
  });

  test('the row: a picture param is a control, its keys coloured from the palette', () => {
    const p = normaliseParam('picture', normalizeParams({ picture: { type: 'picture', value: pic(['r']) } }).picture);
    assert.equal(p.kind, 'picture');
    const palette = { body: ['#112233', '#445566'] };
    assert.equal(keyColour('body2', palette), '#445566');
    assert.equal(keyColour('#abcdef 40%', palette), 'color-mix(in srgb, #abcdef 40%, black)');
    assert.equal(keyColour('high', palette), '#112233', 'a role the palette lacks: body');
  });
});
