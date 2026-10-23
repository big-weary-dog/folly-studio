// Modulators (SPEC "Globals"): a macro with its own binding moves every param bound to it in step; a lane wins over
// it; an LFO's amount scales its swing and its pace runs its phase on a fader's integral, so a fader never jumps it;
// one level only (a modulator follows faders), refused by the schema and dropped by the core.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { normalizeGlobals, prepareLook } from '../public/js/pattern-core.ts';
import { lookFrame } from '../public/js/core/globals.ts';
import { validateLook } from '../shared/schemas/generated.ts';
import { Globals } from '../shared/schemas/look.ts';
import { freeName, renameMacro } from '../public/js/ui/look-globals-edit.ts';
import { macroUses, moveText, useText } from '../public/js/ui/mod-uses.ts';

const wobble = { value: 0, min: 0, max: 1, mod: { mod: 'lfo', shape: 'saw', rate: 0.5, center: 0.5, depth: 0.5 } };
const at = (look, t, name) => { const L = prepareLook(look); lookFrame(L, t); return L.G[name]; };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

describe('a macro with a mod', () => {
  test('moves by its binding every frame, and normAt agrees (clocks read it)', () => {
    const look = { globals: { macros: { wobble } } };
    near(at(look, 0.5, 'wobble'), 0.25);
    near(at(look, 1.5, 'wobble'), 0.75);
    near(prepareLook(look).normAt('wobble', 1.5), 0.75);
  });

  test('a lane wins over it', () => {
    near(at({ globals: { macros: { wobble } }, automation: { wobble: [[0, 0.9]] } }, 1.5, 'wobble'), 0.9);
  });

  test('follows a fader: a global binding to a plain macro', () => {
    const look = { globals: { macros: { storm: { value: 0.4 }, gust: { value: 0, mod: { mod: 'global',
      name: 'storm', from: 0, to: 0.5 } } } } };
    near(at(look, 3, 'gust'), 0.2);
  });

  test('amount scales its swing by a fader: 0 holds it at its centre', () => {
    const mod = (v) => ({ globals: { macros: { calm: { value: v }, w: { ...wobble, mod: { ...wobble.mod,
      amount: 'calm' } } } } });
    near(at(mod(0), 1.5, 'w'), 0.5);
    near(at(mod(0.5), 1.5, 'w'), 0.625);
  });

  test('pace multiplies its rate by a fader\'s value, on the fader\'s integral (a lane: no jump)', () => {
    const paced = (storm, automation) => ({ automation, globals: { macros: { storm: { value: storm, min: 0, max: 4 },
      w: { ...wobble, mod: { ...wobble.mod, pace: 'storm' } } } } });
    near(at(paced(2), 0.5, 'w'), 0.5, 1e-6);            // twice as fast: half a cycle at 0.5 s
    const lane = [[0, 1], [4, 3]];                    // ∫ to t = t + t²/4
    near(at(paced(1, { storm: lane }), 2, 'w'), (0.5 * 3) % 1);
    const a = at(paced(1, { storm: lane }), 2, 'w'), b = at(paced(1, { storm: lane }), 2 + 1e-4, 'w');
    assert.ok(Math.abs(b - a) < 1e-3, 'continuous while the fader moves');
  });

  test('a live push on a pace fader keeps the phase (repace)', () => {
    const L = prepareLook({ globals: { macros: { storm: { value: 1, min: 0, max: 4 },
      w: { ...wobble, mod: { ...wobble.mod, pace: 'storm' } } } } });
    lookFrame(L, 1.2);
    const before = L.G.w, m = L.g.macros.find((x) => x.name === 'storm');
    L.repace('storm', m.value, 3, 1.2);
    m.value = 3;
    lookFrame(L, 1.2);
    near(L.G.w, before);
  });
});

describe('one level', () => {
  const chained = { macros: { a: wobble, b: { value: 0, mod: { mod: 'global', name: 'a' } },
    c: { ...wobble, mod: { ...wobble.mod, amount: 'a', pace: 'speed' } } } };

  test('the schema refuses a modulator that follows a modulator, and the clip envelope on a macro', () => {
    const r = Globals.safeParse(chained);
    assert.equal(r.success, false);
    assert.match(r.error.issues[0].message, /macros\.b follows a, which is not a macro without a mod/);
    assert.equal(Globals.safeParse({ macros: { e: { value: 0, mod: { mod: 'envelope' } } } }).success, false);
    const ok = Globals.parse({ macros: { storm: { value: 1, max: 4 }, w: { ...wobble, mod: { ...wobble.mod,
      pace: 'storm', amount: 'energy' } } } });
    assert.equal(ok.macros.w.mod.pace, 'storm', 'a modulator keeps its mod');
  });

  test('the core drops what the schema refuses', () => {
    const g = normalizeGlobals(chained), by = Object.fromEntries(g.macros.map((m) => [m.name, m]));
    assert.equal(by.b.mod, undefined, 'b followed a modulator');
    assert.equal(by.c.mod.amount, undefined);
    assert.equal(by.c.mod.pace, undefined, 'speed is no fader');
    assert.equal(normalizeGlobals({ macros: { e: { mod: { mod: 'envelope' } } } }).macros[0].mod, undefined);
  });
});

test('renaming a fader carries the params and modulators that follow it; deleting one lets them go', () => {
  const look = { layers: [{ id: 'a', modules: [{ id: 'm', params: {
    speed: { mod: 'global', name: 'storm', from: 1, to: 2 },
    gap: { mod: 'lfo', rate: 1, pace: 'storm', amount: 'calm' },
    tint: { name: 'x', rotate: { mod: 'global', name: 'storm' } } } }] }],
  globals: { macros: { storm: { value: 1, min: 0, max: 4 }, w: { ...wobble, mod: { ...wobble.mod, pace: 'storm' } },
    g: { value: 0, min: 0, max: 1, mod: { mod: 'global', name: 'storm' } } } }, automation: { storm: [[0, 1]] } };
  const r = renameMacro(look, 'storm', 'gale'), p = r.layers[0].modules[0].params;
  assert.equal(p.speed.name, 'gale');
  assert.equal(p.gap.pace, 'gale');
  assert.equal(p.tint.rotate.name, 'gale');
  assert.equal(r.globals.macros.w.mod.pace, 'gale');
  assert.equal(r.globals.macros.g.mod.name, 'gale');
  assert.ok(r.automation.gale);
  const d = renameMacro(look, 'storm', null), q = d.layers[0].modules[0].params;
  assert.equal(q.speed, undefined);
  assert.deepEqual(q.gap, { mod: 'lfo', rate: 1, amount: 'calm' });
  assert.equal(q.tint.rotate, 0);
  assert.equal(d.globals.macros.w.mod.pace, undefined);
  assert.equal(d.globals.macros.g.mod, undefined);
  assert.equal(freeName({}, 'Rose window', 'Speed (bars a second)'), 'roseSpeed');
  assert.equal(freeName({ roseSpeed: {} }, 'Rose window', 'Speed (bars a second)'), 'roseSpeed2');
  assert.equal(freeName({}, '3D glow!'), 'd');
  assert.equal(freeName({}, '', 'Palette'), 'palette2'); // palette is the look's
  assert.equal(freeName({}, '!!'), 'mod');
});

test('a generator\'s modulators: kept with their mod and the bpm; one that follows a modulator is held still', () => {
  const lfo = { mod: 'lfo', rate: 0.25, unit: 'beats', center: 0.5, depth: 0.5 };
  const out = validateLook({ title: 't', summary: 's', bpm: 300, layers: [{ title: 'a', groups: ['all'],
    blend: 'add', level: 1, code: 'function pixel(p, t, P, G) { return [1, 1, 1]; }' }],
  globals: { macros: [{ name: 'storm', value: 1, min: 0.5, max: 3 },
    { name: 'breath', value: 0.5, min: 0, max: 1, mod: { ...lfo, pace: 'storm' } },
    { name: 'echo', value: 0, min: 0, max: 1, mod: { ...lfo, amount: 'breath' } },
    { name: 'clip', value: 0, min: 0, max: 1, mod: { mod: 'envelope' } }] } });
  assert.equal(out.bpm, 240);
  assert.deepEqual(out.globals.macros.breath.mod, { ...lfo, pace: 'storm' });
  assert.equal(out.globals.macros.echo.mod, undefined);
  assert.equal(out.globals.macros.clip.mod, undefined);
  assert.equal(out.dropped.length, 2, out.dropped.join('; '));
});

test('what drives what: params following a macro, LFOs it swings or paces, a colour\'s rotate, other macros', () => {
  const breath = { mod: 'lfo', shape: 'sine', rate: 0.25, unit: 'beats', center: 0.5, depth: 0.5, pace: 'storm' };
  const look = { globals: { macros: { storm: { value: 1, min: 0, max: 4 }, breath: { value: 0.5, min: 0, max: 1,
    mod: breath } } }, layers: [{ id: 'a', modules: [{ id: 'm', params: {
    level: { mod: 'global', name: 'breath', from: 0.2, to: 0.6 },
    hue: { mod: 'lfo', rate: 1, amount: 'storm' },
    tint: { role: 'body', rotate: { mod: 'global', name: 'breath' } }, size: 3 } }] }] };
  const uses = macroUses(look);
  assert.deepEqual(uses.get('breath')?.map((u) => [u.how, u.layer, u.module, u.key]),
    [['follows', 'a', 'm', 'level'], ['follows', 'a', 'm', 'tint']]);
  assert.deepEqual(uses.get('storm')?.map((u) => [u.how, u.key ?? u.macro]), [['swing', 'hue'], ['pace', 'breath']]);
  assert.equal(useText(uses.get('storm')[1], 'breath'), 'pace of breath');
  assert.equal(moveText(breath), '∿ sine 1 bar × storm');
  assert.equal(moveText({ ...breath, pace: undefined, amount: 'energy' }), '∿ sine 1 bar · swing × energy');
});
