// The shared zod schemas (shared/schemas/): the API's strict look and its messages, the rig, and the account bodies.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';
import { z } from 'zod';

import ACCOUNT from '../public/data/account.json' with { type: 'json' };
import { Login, Signup } from '../shared/schemas/api.ts';
import { automationFor, Globals, Layers, type Module, problem } from '../shared/schemas/look.ts';
import { LibraryEntry } from '../shared/schemas/rig.ts';

const PIXEL = 'function pixel(p) { return [1, 1, 1]; }';
/** The parsed value, or the sentence problem() makes of its first issue. */
function check<T extends z.ZodType>(schema: T, value: unknown): z.output<T> | string {
  const r = schema.safeParse(value);
  return r.success ? r.data : problem(r.error);
}
const layers = (list: unknown) => check(z.object({ layers: Layers }), { layers: list });
const globals = (g: unknown) => check(z.object({ globals: Globals }), { globals: g });
const lanes = (a: unknown, g?: { macros?: Record<string, { min: number, max: number }> }) =>
  check(z.object({ automation: automationFor(g) }), { automation: a });

describe('the API look', () => {
  test('defaults, ids, tags kept once, empty clips stored as none, groups none given or none picked', () => {
    const out = layers([{ code: PIXEL, tags: ['rose', 'rose'], clips: [] },
      { modules: [{ code: PIXEL }, { kind: 'filter', code: 'function filter(c) { return c; }', enabled: true }],
        groups: [] }]);
    assert.deepEqual(out, { layers: [
      { id: 'l1', title: '', code: PIXEL, params: {}, tags: ['rose'], blend: 'add', level: 1 },
      { id: 'l2', title: '', modules: [
        { id: 'm1', kind: 'source', title: '', code: PIXEL, params: {} },
        { id: 'm2', kind: 'filter', title: '', code: 'function filter(c) { return c; }', params: {} },
      ], groups: [], blend: 'add', level: 1 },
    ] });
  });

  test('problems name where they are', () => {
    assert.equal(layers([{ code: PIXEL }, { modules: [{ code: PIXEL, input: 3 }] }]),
      'Layer 2, module 1: input must be a module id.');
    assert.equal(layers([{ code: PIXEL, params: { speed: { mod: 'lfo', unit: 'bars' } } }]),
      'Layer 1, param speed has an unsupported value.');
    assert.equal(layers([{ code: PIXEL, clips: [{ start: 0, end: 1 }, 'x'] }]), 'Layer 1, clip 2 must be an object.');
    assert.equal(layers(Array.from({ length: 9 }, () => ({ code: PIXEL }))), 'A look can have at most 8 layers.');
    const big = 'x'.repeat(19 * 1024);
    assert.equal(layers([{ modules: [1, 2, 3, 4].map(() => ({ code: big })) }]),
      "Layer 1: its modules' code is over 64 kB.");
  });

  test('soften: kept, rounded, its mode defaulted; out of range refused; null is none', () => {
    const out = layers([{ code: PIXEL, soften: { radius: 0.1234567891 } }, { code: PIXEL, soften: null }]);
    assert.deepEqual((out as { layers: { soften?: object }[] }).layers.map((l) => l.soften),
      [{ radius: 0.123457, mode: 'wire' }, undefined]);
    assert.equal(layers([{ code: PIXEL, soften: { radius: 2 } }]),
      'Layer 1: soften.radius must be a number of metres from 0 to 1.5.');
    assert.equal(layers([{ code: PIXEL, soften: { radius: 0.2, mode: 'fog' } }]),
      'Layer 1: soften.mode must be one of wire, space, both.');
  });

  test('globals: a palette by name filled in, colours lower-cased, macros defaulted and rounded', () => {
    const out = globals({ palette: { name: 'mine', low: ['#FF0000'] }, hue: 0.1234567891,
      macros: { storm: { value: 0.1234567891 }, wind: { min: -2, max: 2 } } });
    assert.deepEqual(out, { globals: { palette: { name: 'mine', low: ['#ff0000'], body: [], accent: [],
      high: [] }, macros: { storm: { value: 0.123457, min: 0, max: 1 }, wind: { value: -2, min: -2, max: 2 } } } });
    assert.equal((globals({ palette: 'carnival' }) as { globals: { palette: { name: string } } }).globals.palette.name,
      'carnival');
    assert.equal(globals({ palette: { low: ['red'] } }), "globals.palette.low must be up to 16 '#rrggbb' colours.");
    assert.equal(globals({ macros: { storm: { value: 2 } } }), 'Macro storm: value must be a number from min to max.');
    assert.deepEqual(globals(null), { globals: null }, 'null clears them');
  });

  test("an old look's Live Play offers load and are dropped", () => {
    assert.deepEqual(layers([{ modules: [{ code: PIXEL, live: ['colours'] }] }]), { layers: [{ id: 'l1', title: '',
      modules: [{ id: 'm1', kind: 'source', title: '', code: PIXEL, params: {} }], blend: 'add', level: 1 }] });
    assert.deepEqual(globals({ macros: { storm: {} }, live: ['bpm', 'storm', 'gone', 'gone'] }),
      { globals: { macros: { storm: { value: 0, min: 0, max: 1 } } } });
  });

  test('prototype keys are never names', () => {
    const forged = JSON.parse('{"__proto__": {"polluted": 1}, "constructor": {"value": 0}}');
    assert.match(String(globals({ macros: forged })), /^Macro constructor: a name is/);
    assert.match(String(lanes(JSON.parse('{"__proto__": [[0, 1]]}'))), /automate one of the look's macros/);
    assert.match(String(lanes({ toString: [[0, 1]] })), /^automation\.toString: automate/);
    assert.equal(({} as { polluted?: number }).polluted, undefined);
  });

  test("automation: lanes for the look's macros, points sorted, to the ms, one per time", () => {
    const storm = { macros: { storm: { min: 0, max: 5 }, energy: { min: 0, max: 1 } } };
    assert.deepEqual(lanes({ energy: [[10.0004, 1], [0, 0.2]], storm: [[0, 3]] }, storm),
      { automation: { energy: [[0, 0.2], [10, 1]], storm: [[0, 3]] } });
    assert.equal(lanes({ energy: [[1.0001, 0], [1, 1]] }, storm), 'automation.energy: two points at 1 s.');
    assert.equal(lanes({ storm: [[0, 0]] }), "automation.storm: automate one of the look's macros.");
    assert.deepEqual(lanes({ speed: [[0, 1]], level: [[0, 0]], hue: [[0, 0]], saturation: [[0, 1]] }),
      { automation: {} }, "an old look's lanes on the removed globals are ignored");
    assert.equal(lanes(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`m${i}`, [[0, 0]]])),
      { macros: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`m${i}`, { min: 0, max: 1 }])) }),
    'At most 16 automation lanes.');
  });
});

describe('the rig, the library index and accounts', () => {
  test('library entries get a title, a summary, string tags and a kind', () => {
    assert.deepEqual(LibraryEntry.parse({ name: 'embers', tags: ['warm', 3], kind: 'nonsense', extra: 1 }),
      { name: 'embers', title: 'embers', summary: '', tags: ['warm'], kind: 'source', category: '', extra: 1 });
    assert.equal(LibraryEntry.safeParse({ name: '../evil' }).success, false);
  });

  test('a signup is checked; a login only ever fails as a wrong one', () => {
    assert.deepEqual(Signup.parse({ username: ' Ana ', password: 'correct horse' }),
      { username: 'ana', password: 'correct horse' });
    assert.equal(check(Signup, { username: 'a b', password: 'correct horse' }),
      'Username must be 3–32 characters: letters, digits, _ or -.');
    assert.equal(check(Signup, { username: 'ana', password: 'x'.repeat(1025) }),
      'Password must be at most 1024 characters.');
    const { usernameMin: USERNAME_MIN, usernameMax: USERNAME_MAX, passwordMin: PASSWORD_MIN } = ACCOUNT;
    const at = (username: string, password: string) => Signup.safeParse({ username, password }).success;
    const [name, pass] = [(n: number) => 'a'.repeat(n), (n: number) => 'x'.repeat(n)];
    assert.deepEqual([at(name(USERNAME_MIN), pass(PASSWORD_MIN)), at(name(USERNAME_MIN - 1), pass(PASSWORD_MIN)),
      at(name(USERNAME_MAX + 1), pass(PASSWORD_MIN)), at(name(USERNAME_MIN), pass(PASSWORD_MIN - 1))],
    [true, false, false, false], 'the sign-up form shows the limits the schema holds');
    assert.deepEqual(Login.parse({ username: 'a b', password: 42 }), { username: null, password: '' });
    assert.deepEqual(Login.parse('nonsense'), { username: null, password: '' });
  });
});

describe('a composite (SPEC-library "Composites")', () => {
  const src = (more = {}) => ({ kind: 'source', code: PIXEL, ...more });
  const layer = (modules: unknown[]) => [{ id: 'l', modules }];
  const comp = (layers: unknown[]) => ({ kind: 'composite', layers });
  test('its sub-layers\' modules get ids of their own by default, unique across the layer', () => {
    const out = check(Layers, layer([comp([{ id: 's1', modules: [src(), src()] }, { id: 's2', modules: [src()] }]),
      src()]));
    assert.ok(typeof out !== 'string', out as string);
    const [c, after] = (out[0] as { modules: Module[] }).modules;
    assert.deepEqual(c.layers!.map((s) => s.modules.map((m) => m.id)), [['s1.m1', 's1.m2'], ['s2.m1']]);
    assert.equal(after.id, 'm2');
  });
  test('an id used twice anywhere in the layer is refused', () => {
    assert.match(String(check(Layers, layer([comp([{ id: 's1', modules: [src({ id: 'x' })] }]), src({ id: 'x' })]))),
      /module id x is used twice/);
    assert.match(String(check(Layers, layer([comp([{ id: 's1', modules: [src({ id: 'y' })] },
      { id: 's2', modules: [src({ id: 'y' })] }])]))), /module id y is used twice/);
  });
});
