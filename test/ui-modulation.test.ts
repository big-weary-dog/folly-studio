// The modulate dialog's bindings and automating a setting, without a browser: a param's control, a binding's form
// and text, the beat clock, and the macro, lane and binding one automation edit makes.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import {
  beatsAt, bindingForm, bindingText, keepsTime, makeBinding, normaliseParam, type Param, perBeat, shownValue,
} from '../public/js/ui/params/bindings.ts';
import { automationEdit } from '../public/js/ui/params/automation-edit.ts';
import type { Draft } from '../public/js/ui/studio/store.ts';
import { automationLevel } from '../public/js/ui/timeline/auto.tsx';

test('automation endpoint brightness uses the macro range, not raw zero and one', () => {
  const range = { min: -2, max: 2, value: 0 };
  assert.deepEqual([-2, 0, 1, 2].map((v) => automationLevel(v, range)), ['low', 'mid', 'mid', 'high']);
});

test('automating a setting creates its macro, lane and binding as one patch, and reuses an existing lane', () => {
  const L = { id: null, title: 'Test', summary: '', shared: false,
    duration: 24, bpm: null, layers: [{ id: 'layer', blend: 'add', level: 1,
    title: 'Clouds', modules: [{ id: 'source', kind: 'source', title: 'Clouds', code: '', params: { speed: 2 } }] }],
  } as Draft;
  const p = { label: 'Speed', min: -2, max: 6 }, target = { layer: 'layer', module: 'source', key: 'speed',
    hint: 'Clouds' };
  const edit = automationEdit(L, p, 2, target)!;
  assert.ok('patch' in edit);
  assert.equal(edit.name, 'cloudsSpeed');
  assert.deepEqual(edit.patch.globals?.macros?.cloudsSpeed, { min: -2, max: 6, value: 2 });
  assert.deepEqual(edit.patch.automation?.cloudsSpeed, [[0, 2], [24, 2]]);
  assert.deepEqual(edit.patch.layers?.[0].modules[0].params?.speed,
    { mod: 'global', name: 'cloudsSpeed', from: -2, to: 6 });
  assert.equal(L.layers[0].modules[0].params?.speed, 2, 'the original look is untouched for Undo');
  assert.deepEqual(automationEdit({ ...L, ...edit.patch }, p, 4, target), { name: 'cloudsSpeed', patch: {} });
});

test('new automation names avoid collisions; colour automation preserves the pick and its options', () => {
  const L = { id: null, title: 'Test', summary: '', shared: false,
    duration: 30, bpm: null, layers: [{ id: 'l', title: 'Bars', blend: 'add', level: 1, modules: [
    { id: 'm', kind: 'source', title: 'Bars', code: '', params: {
      colours: { pick: 'body/accent', blend: 'smooth', range: [0.2, 0.8] } } }] }] } as Draft;
  const p = { label: 'Colours: rotate', min: 0, max: 1 };
  const first = automationEdit(L, p, 0.5)!;
  assert.ok('patch' in first);
  assert.equal(first.name, 'automation');
  const second = automationEdit({ ...L, ...first.patch }, p, 0.5);
  assert.ok('patch' in second);
  assert.equal(second.name, 'automation2');
  const turn = automationEdit(L, p, 0.25, { layer: 'l', module: 'm', key: 'colours', hint: 'Bars',
    colour: { value: 'all', blend: 'step' } })!;
  assert.ok('patch' in turn);
  assert.deepEqual(turn.patch.layers?.[0].modules[0].params?.colours, {
    pick: 'body/accent', blend: 'smooth', range: [0.2, 0.8],
    rotate: { mod: 'global', name: turn.name, from: 0, to: 1 } });
  const full = { ...L, globals: { macros: Object.fromEntries(Array.from({ length: 16 }, (_, i) =>
    [`macro${i}`, { min: 0, max: 1, value: 0.5 }])) } };
  assert.deepEqual(automationEdit(full, p, 0.5), { error: 'limit' }, 'the API macro limit is respected');
});

describe('modulation', () => {
  const p = normaliseParam('speed', { value: 60, min: 5, max: 200 }) as Param;
  const globals = ['energy', 'speed', 'storm'];

  test('a number param gets a nice step; colours and toggles their own controls', () => {
    assert.deepEqual([p.kind, p.min, p.max, p.step], ['number', 5, 200, 0.5]);
    assert.equal(normaliseParam('w', { value: 0.25, min: 0.02, max: 1 })?.step, 0.002);
    assert.equal(normaliseParam('c', { value: [1, 0.5, 0], type: 'color' })?.value, '#ff8000');
    assert.equal(normaliseParam('t', { value: 1, type: 'toggle' })?.value, true);
    assert.equal(normaliseParam('s', { value: 'text' }), null);
    const choice = normaliseParam('mode', { value: 'fog', type: 'choice', options: ['wire', 'space'] }) as Param;
    assert.deepEqual([choice.kind, choice.value, choice.options], ['choice', 'wire', ['wire', 'space']]);
    assert.deepEqual(shownValue(choice, { mode: 'space' }, 'mode').value, 'space');
    assert.deepEqual(shownValue(choice, { mode: 'fog' }, 'mode').value, 'wire');
  });

  test('the dialog opens on the binding there is, keeps global and envelope ends apart, and falls back', () => {
    const f = bindingForm({ mod: 'global', name: 'storm', from: 20, to: 160 }, p, globals);
    assert.deepEqual([f.mod, f.name, f.from, f.to, f.eFrom, f.eTo], ['global', 'storm', '20', '160', '5', '200']);
    assert.deepEqual(makeBinding({ ...f, mod: 'envelope' }, p), { mod: 'envelope', from: 5, to: 200 });
    assert.equal(bindingForm({}, p, globals).name, 'energy', 'an unknown name takes the first global');
    const lfo = makeBinding({ ...bindingForm({}, p, globals), mod: 'lfo', rate: 'fast', hi: '' }, p);
    assert.deepEqual(lfo, { mod: 'lfo', shape: 'sine', rate: 1, unit: 'beats', center: 105.625, depth: 94.375 },
      'a new LFO counts beats; an unparsed end takes the range\'s');
    assert.equal(makeBinding({ ...f, mod: '' }, p), null, 'nothing: its field sets it');
    assert.equal(bindingText(lfo!, p), '∿ sine 1 beat · 11.25…200');
    const slow = makeBinding(bindingForm({ mod: 'lfo', rate: 0.0625, unit: 'beats' }, p, globals), p);
    assert.equal((slow as { rate: number }).rate, 0.0625, '4 bars stays exact');
    assert.equal(bindingText({ mod: 'lfo', unit: 'hz', rate: 0.25, shape: 'tri', center: 0, depth: 1 }),
      '⋀ tri 0.25 Hz · -1…1');
    assert.equal(bindingText({ mod: 'lfo', unit: 'beats', rate: 1 / 3, center: 0, depth: 1 }),
      '∿ sine every 3 beats · -1…1');
    assert.equal(bindingText({ mod: 'global', name: 'storm', from: 20, to: 160 }), '◆ storm · 20…160');
  });

  test('From/To: a new LFO swings a quarter of the range round the field\'s value; an old one shows its ends', () => {
    const f = bindingForm({}, p, globals, 190);
    assert.deepEqual([f.lo, f.hi, f.unit, f.rate], ['141.25', '200', 'beats', '0.25'], 'held to the range; 1 bar');
    const g = bindingForm({ mod: 'lfo', center: 40, depth: 10 }, p, globals);
    assert.deepEqual([g.lo, g.hi, g.unit], ['30', '50', 'hz']);
    assert.deepEqual(makeBinding({ ...g, lo: '95', hi: '20' }, p), { mod: 'lfo', shape: 'sine', rate: 0.25,
      unit: 'hz', center: 57.5, depth: -37.5 }, 'From above To runs the wave upside down');
  });

  test('the beat clock: on speeds, spins and rates a minute, per beat at the look\'s tempo', () => {
    const clouds = normaliseParam('speed', { value: 0.15, min: 0, max: 1 }) as Param;
    const often = normaliseParam('often', { value: 36, min: 0, max: 1200, unit: 'minute' }) as Param;
    const tempo = normaliseParam('rate', { value: 120, min: 10, max: 240 }) as Param;
    assert.deepEqual([keepsTime('speed', clouds), keepsTime('often', often), keepsTime('rate', tempo)],
      [true, true, false], 'heartbeat\'s own tempo is a tempo, not a speed');
    assert.equal(keepsTime('speed', normaliseParam('speed', { value: true, type: 'toggle' }) as Param), false);
    assert.equal(keepsTime('spin', normaliseParam('spin', { value: 0, min: -1, max: 1 }) as Param), true,
      'a spin, turns a second, is a speed too');
    assert.equal(beatsAt(120, clouds), 2, '2 beats a second at 120');
    assert.equal(beatsAt(120, often), 120, 'a minute\'s');
    assert.equal(bindingForm({ mod: 'beats', per: 0.075 }, clouds, globals).per, '0.075');
    const f = { ...bindingForm({}, clouds, ['energy']), mod: 'beats' as const, per: '0.5' };
    assert.deepEqual(makeBinding(f, clouds), { mod: 'beats', per: 0.5 });
    assert.equal(bindingText({ mod: 'beats', per: 0.5 }), '♩ 0.5 a beat');
    assert.deepEqual(['Speed (clouds a second)', 'How often (flashes a minute)', 'Drops (a second)'].map(perBeat),
      ['Speed (clouds a beat)', 'How often (flashes a beat)', 'Drops (a beat)'], 'the label reads per beat');
  });

  test('what a control shows: its value, the default, or nothing while bound', () => {
    assert.deepEqual(shownValue(p, {}, 'speed'), { has: false, bound: false, value: 60 });
    assert.deepEqual(shownValue(p, { speed: 90 }, 'speed'), { has: true, bound: false, value: 90 });
    assert.ok(Number.isNaN(shownValue(p, { speed: { mod: 'envelope' } }, 'speed').value));
  });
});
