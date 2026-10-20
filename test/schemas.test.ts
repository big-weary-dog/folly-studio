// The shared zod schemas (shared/schemas/): the API's strict look and its messages, the lenient cleaning of a
// generator's look, the structured-output schema made from it, the rig, and the account bodies.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';
import { z } from 'zod';

import { BLENDS, DEFAULT_SOFTEN, MODULE_KINDS, SOURCE_BLENDS } from '../public/js/pattern-core.ts';
import ACCOUNT from '../public/data/account.json' with { type: 'json' };
import { Login, Signup } from '../shared/schemas/api.ts';
import { validateLook, wireSchema } from '../shared/schemas/generated.ts';
import {
  automationFor, BLEND_MODES, Globals, KINDS, Layers, problem, SOURCE_BLEND_MODES,
} from '../shared/schemas/look.ts';
import { LibraryEntry, Rig } from '../shared/schemas/rig.ts';
import { folly, lineRig, mini } from './fixtures/rigs.js';

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
  test("the schema's names are the core's", () => {
    assert.deepEqual([...BLEND_MODES], [...BLENDS]);
    assert.deepEqual([...SOURCE_BLEND_MODES], [...BLENDS, 'under']);
    assert.deepEqual([...SOURCE_BLENDS], [...SOURCE_BLEND_MODES]);
    assert.deepEqual([...KINDS], [...MODULE_KINDS]);
  });

  test('under is how a source combines, not a layer blend', () => {
    assert.equal(typeof layers([{ modules: [{ code: PIXEL }, { code: PIXEL, blend: 'under' }] }]), 'object');
    assert.match(String(layers([{ code: PIXEL, blend: 'under' }])), /^Layer 1: blend must be one of add, over/);
  });

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
    assert.deepEqual(out, { globals: { hue: 0.123457, palette: { name: 'mine', low: ['#ff0000'], body: [], accent: [],
      high: [] }, macros: { storm: { value: 0.123457, min: 0, max: 1 }, wind: { value: -2, min: -2, max: 2 } } } });
    assert.equal((globals({ palette: 'carnival' }) as { globals: { palette: { name: string } } }).globals.palette.name,
      'carnival');
    assert.equal(globals({ palette: { low: ['red'] } }), "globals.palette.low must be up to 16 '#rrggbb' colours.");
    assert.equal(globals({ macros: { storm: { value: 2 } } }), 'Macro storm: value must be a number from min to max.');
    assert.deepEqual(globals(null), { globals: null }, 'null clears them');
  });

  test('prototype keys are never names', () => {
    const forged = JSON.parse('{"__proto__": {"polluted": 1}, "constructor": {"value": 0}}');
    assert.match(String(globals({ macros: forged })), /^Macro constructor: a name is/);
    assert.match(String(lanes(JSON.parse('{"__proto__": [[0, 1]]}'))), /automate a global or one of the look's macros/);
    assert.match(String(lanes({ toString: [[0, 1]] })), /^automation\.toString: automate/);
    assert.equal(({} as { polluted?: number }).polluted, undefined);
  });

  test("automation: lanes for the globals and the look's macros, points sorted, to the ms, one per time", () => {
    const storm = { macros: { storm: { min: 0, max: 5 } } };
    assert.deepEqual(lanes({ energy: [[10.0004, 1], [0, 0.2]], storm: [[0, 3]] }, storm),
      { automation: { energy: [[0, 0.2], [10, 1]], storm: [[0, 3]] } });
    assert.equal(lanes({ energy: [[1.0001, 0], [1, 1]] }), 'automation.energy: two points at 1 s.');
    assert.equal(lanes({ storm: [[0, 0]] }), "automation.storm: automate a global or one of the look's macros.");
    assert.equal(lanes(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`m${i}`, [[0, 0]]])),
      { macros: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`m${i}`, { min: 0, max: 1 }])) }),
    'At most 16 automation lanes.');
  });
});

describe("a generator's look, cleaned", () => {
  const groups = [{ id: 'all', parent: null, tags: ['all'] }, { id: 'rose', parent: 'all', tags: ['rose'] }];

  test('unknown group ids go; with tags the layer is placed by them, else on the root; [] is kept', () => {
    const look = validateLook({ layers: [
      { code: PIXEL, groups: ['nope'], tags: ['rose', 'Not a tag', 'rose'] },
      { code: PIXEL, groups: ['nope', ' rose '] },
      { code: PIXEL, groups: 'nope' },
    ] }, { groups });
    assert.deepEqual(look.layers.map((l) => [l.groups, l.tags]), [[[], ['rose']], [['rose'], undefined],
      [['all'], undefined]]);
    const none = validateLook({ layers: [{ code: PIXEL, groups: [] }, { code: PIXEL }] }, { groups });
    assert.deepEqual(none.layers.map((l) => l.groups), [[], ['all']], 'none picked stays none; none given: the root');
    assert.deepEqual(look.dropped, []);
  });

  test('clips sorted, times from strings, fades held to 0–600 s, a bad one noted', () => {
    const look = validateLook({ duration: ' 45 ', layers: [{ code: PIXEL, clips: [
      { start: '20', end: 30, fadeIn: 900, fadeOut: -2 }, { start: 0, end: 10.00049, fadeIn: 'x' }, { end: 3 },
    ] }] });
    assert.equal(look.duration, 45);
    assert.deepEqual(look.layers[0]!.clips, [{ start: 0, end: 10, fadeIn: 0, fadeOut: 0 },
      { start: 20, end: 30, fadeIn: 600, fadeOut: 0 }]);
    assert.deepEqual(look.dropped, ['layer 1: a clip without a valid start and end']);
  });

  test('aliases mended, values clamped, params kept only when usable', () => {
    const look = validateLook({ layers: [{ code: PIXEL, blend: ' Screen ', level: -3, params: {
      color: '#ABCDEF', rgb: [2, 0.5, -1], on: true, lfo: { mod: 'lfo', rate: 1 }, '1bad': 1, worse: { a: 1 } } },
    { modules: [{ kind: 'pattern', code: PIXEL }, { kind: 'effect', code: 'function filter(c) { return c; }' },
      { kind: 'transform', code: 'function warp(q) {}', blend: 'NORMAL' }] }] });
    const [a, b] = look.layers as unknown as [{ blend: string, level: number, params: object },
      { modules: { kind: string, blend?: string }[] }];
    assert.deepEqual([a.blend, a.level], ['max', 0]);
    assert.deepEqual(a.params, { color: '#abcdef', rgb: [1, 0.5, 0], on: true, lfo: { mod: 'lfo', rate: 1 } });
    assert.deepEqual(b.modules.map((m) => [m.kind, m.blend]), [['source', undefined], ['filter', undefined],
      ['warp', 'over']]);
  });

  test('layers soften by default, a given soften held to range; a choice param is a word', () => {
    const look = validateLook({ layers: [{ code: PIXEL, params: { mode: 'space', bad: 'Not a word!' } },
      { code: PIXEL, soften: { radius: 7, mode: 'fog' } }, { code: PIXEL, soften: { radius: 0 } }] });
    assert.deepEqual(look.layers.map((l) => l.soften), [DEFAULT_SOFTEN, { radius: 1.5, mode: 'wire' },
      { radius: 0, mode: 'wire' }]);
    assert.deepEqual((look.layers[0] as { params?: object }).params, { mode: 'space' });
  });

  test('globals and automation as maps or lists; what the API refuses is dropped and noted', () => {
    const look = validateLook({ layers: [{ code: PIXEL }], globals: { speed: 9, palette: { name: 'ember' },
      macros: { storm: { value: 3, max: 2 } } }, automation: { storm: [[700, 5], [1, 1], ['x', 1]] } });
    assert.deepEqual(look.globals?.macros, { storm: { value: 2, min: 0, max: 2 } });
    assert.equal(look.globals?.speed, 4);
    assert.equal(look.globals?.palette?.name, 'ember');
    assert.deepEqual(look.automation, { storm: [[1, 1], [600, 2]] });
    const refused = validateLook({ layers: [{ code: PIXEL }],
      globals: { macros: [{ name: 'big', min: 0, max: 1e9 }] } });
    assert.equal(refused.globals, undefined);
    assert.match(refused.dropped.join(), /^globals: Macro big: min and max must be numbers/);
  });

  test('its JSON Schema is one structured output takes: closed objects, no bounds, defaults or patterns', () => {
    const schema = wireSchema(folly.groups);
    const allowed = new Set(['type', 'properties', 'required', 'items', 'enum', 'const', 'anyOf', 'description',
      'additionalProperties']);
    const walk = (node: Record<string, unknown>, at: string) => {
      for (const key of Object.keys(node)) assert.ok(allowed.has(key), `${at}: ${key}`);
      if (node.type === 'object') {
        assert.equal(node.additionalProperties, false, at);
        const props = node.properties as Record<string, Record<string, unknown>>;
        for (const r of node.required as string[]) assert.ok(r in props, `${at}: ${r} is required but not there`);
        for (const [k, p] of Object.entries(props)) walk(p, `${at}.${k}`);
      }
      if (node.items) walk(node.items as Record<string, unknown>, `${at}[]`);
      if (node.enum) assert.ok((node.enum as unknown[]).length, `${at}: an empty enum`);
    };
    walk(schema, 'look');
    const layer = (schema as { properties: { layers: { items: { properties: Record<string, { items: { enum?:
      string[] } }>, required: string[] } } } }).properties.layers.items;
    assert.deepEqual(layer.required, ['title', 'groups', 'blend', 'level']);
    assert.ok(layer.properties.groups!.items.enum!.includes('rose-window'));
    assert.ok(layer.properties.tags!.items.enum!.includes('rose'));
    assert.equal('params' in layer.properties, false, "a pattern's code carries its params");
    const many = Array.from({ length: 401 }, (_, i) => ({ id: `g${i}`, parent: i ? 'g0' : null }));
    const wide = wireSchema(many) as typeof schema & { properties: { layers: { items: { properties: { groups:
      { items: object } } } } } };
    assert.deepEqual(wide.properties.layers.items.properties.groups.items, { type: 'string' }, 'ids past 400: free');
  });
});

describe('the rig, the library index and accounts', () => {
  test("rigs as SPEC \"Rig\" has them; a malformed one says what is wrong", () => {
    for (const rig of [folly, mini, lineRig(3)]) assert.ok(Rig.safeParse(rig).success);
    const { output: _output, ...noOutput } = lineRig(3);
    assert.equal(check(Rig, noOutput), 'Invalid input: expected object, received undefined');
    assert.equal(check(Rig, { ...lineRig(3), groups: undefined }) && Rig.parse({ ...lineRig(3), groups: undefined })
      .groups.length, 0);
  });

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
