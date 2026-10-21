// The UI's logic that decides behaviour, without a browser: routing (redirects and `next`), the modulate dialog's
// bindings, the scrub field's values and how a chain is drawn, the pick tile's edits, the timeline's zoom and edits on
// the Studio's state, and the sandbox status (a broken edit keeps the last good code running). The views themselves
// are checked in a browser (`npm run smoke`).
import assert from 'node:assert/strict';

import { computed, signal } from '@preact/signals';
import { describe, test } from 'vitest';

import { resolve, safeNext } from '../public/js/ui/app.tsx';
import { gateOf } from '../public/js/ui/idea-access.tsx';
import {
  beatsAt, bindingForm, bindingText, fmt, keepsTime, makeBinding, normaliseParam, type Param, perBeat, shownValue,
  upgradedOf,
} from '../public/js/ui/bindings.ts';
import { decimals, exact, onSpan, places, scrubTo, snap } from '../public/js/ui/kit.tsx';
import { profile } from '../public/js/ui/session.ts';
import { onIdeas, pathsHere } from '../public/js/ui/tour/paths/index.ts';
import { createLayerStatus } from '../public/js/ui/layer-status.ts';
import {
  addColour, CUSTOM_MAX, editText, editValue, readEdit, toggleRole, toggleSlot, toggleToken,
} from '../public/js/ui/pick-model.ts';
import type { Preview } from '../public/js/ui/preview.ts';
import type { Draft, Studio } from '../public/js/ui/studio-store.ts';
import { createTimeline } from '../public/js/ui/timeline-state.ts';
import { automationLevel } from '../public/js/ui/timeline-auto.tsx';
import { laneNow } from '../public/js/ui/look-globals.tsx';
import { automationEdit } from '../public/js/ui/automation-edit.ts';
import { chainWires, isStageEnd, type Layer } from '../public/js/ui/model.ts';
import type { Module } from '../shared/schemas/look.ts';

const where = (path: string, search = '', signedIn = true) => {
  const r = resolve(path, search, signedIn);
  return 'redirect' in r ? `→ ${r.redirect}` : `${r.route.name} ${JSON.stringify(r.params)}`;
};

test('automation endpoint brightness uses the macro range, not raw zero and one', () => {
  const range = { min: -2, max: 2, value: 0 };
  assert.deepEqual([-2, 0, 1, 2].map((v) => automationLevel(v, range)), ['low', 'mid', 'mid', 'high']);
});

test('automating a setting creates its macro, lane and binding as one patch, and reuses an existing lane', () => {
  const L = { id: null, title: 'Test', summary: '', shared: false, ideaId: null,
    duration: 24, bpm: null, layers: [{ id: 'layer', blend: 'add', level: 1,
    title: 'Clouds', modules: [{ id: 'source', kind: 'source', title: 'Clouds', code: '', params: { speed: 2 } }] }],
  } as Draft;
  const p = { label: 'Speed', min: -2, max: 6 }, target = { layer: 'layer', module: 'source', key: 'speed',
    hint: 'Clouds' };
  const edit = automationEdit(L, p, 2, target)!;
  assert.equal(edit.name, 'cloudsSpeed');
  assert.deepEqual(edit.patch.globals?.macros?.cloudsSpeed, { min: -2, max: 6, value: 2 });
  assert.deepEqual(edit.patch.automation?.cloudsSpeed, [[0, 2], [24, 2]]);
  assert.deepEqual(edit.patch.layers?.[0].modules[0].params?.speed,
    { mod: 'global', name: 'cloudsSpeed', from: -2, to: 6 });
  assert.equal(L.layers[0].modules[0].params?.speed, 2, 'the original look is untouched for Undo');
  assert.deepEqual(automationEdit({ ...L, ...edit.patch }, p, 4, target), { name: 'cloudsSpeed', patch: {} });
});

test('new automation names avoid collisions; colour automation preserves the pick and its options', () => {
  const L = { id: null, title: 'Test', summary: '', shared: false, ideaId: null,
    duration: 30, bpm: null, layers: [{ id: 'l', title: 'Bars', blend: 'add', level: 1, modules: [
    { id: 'm', kind: 'source', title: 'Bars', code: '', params: {
      colours: { pick: 'body/accent', blend: 'smooth', range: [0.2, 0.8] } } }] }] } as Draft;
  const p = { label: 'Colours: rotate', min: 0, max: 1 };
  const first = automationEdit(L, p, 0.5)!;
  assert.equal(first.name, 'automation');
  assert.equal(automationEdit({ ...L, ...first.patch }, p, 0.5)!.name, 'automation2');
  const turn = automationEdit(L, p, 0.25, { layer: 'l', module: 'm', key: 'colours', hint: 'Bars',
    colour: { value: 'all', blend: 'step' } })!;
  assert.deepEqual(turn.patch.layers?.[0].modules[0].params?.colours, {
    pick: 'body/accent', blend: 'smooth', range: [0.2, 0.8],
    rotate: { mod: 'global', name: turn.name, from: 0, to: 1 } });
  const full = { ...L, globals: { macros: Object.fromEntries(Array.from({ length: 16 }, (_, i) =>
    [`macro${i}`, { min: 0, max: 1, value: 0.5 }])) } };
  assert.equal(automationEdit(full, p, 0.5), null, 'the API macro limit is respected');
});

describe('routing', () => {
  test('the same URLs, with redirects for the signed out and the signed in', () => {
    assert.equal(where('/'), '→ /ideas');
    assert.equal(where('/', '', false), '→ /login');
    assert.equal(where('/studio/a%20b'), 'studio {"lookId":"a b"}');
    assert.equal(where('/studio/'), 'studio {}');
    assert.equal(where('/gallery'), 'gallery {}');
    assert.equal(where('/nowhere'), '→ /ideas');
    assert.equal(where('/studio/x', '?y=1', false), '→ /login?next=%2Fstudio%2Fx%3Fy%3D1');
    assert.equal(where('/login', '?next=%2Fgallery'), '→ /gallery');
    assert.equal(where('/login', '', false), 'auth {}');
  });

  test('the admin pages are tabs under /admin; /admin and their old URLs lead to them', () => {
    assert.equal(where('/admin/light'), 'light {}');
    assert.equal(where('/admin'), '→ /admin/models');
    assert.equal(where('/admin/'), '→ /admin/models');
    assert.equal(where('/models'), '→ /admin/models');
    assert.equal(where('/access/'), '→ /admin/access');
    assert.equal(where('/light'), '→ /admin/light');
    assert.equal(where('/reports', '?id=r1'), '→ /admin/reports?id=r1');
    assert.equal(where('/admin/reports', '', false), '→ /login?next=%2Fadmin%2Freports');
  });

  test('on the Pi, home is My looks and the pages of what it does not run lead elsewhere', () => {
    profile.value = 'pi';
    try {
      assert.equal(where('/'), '→ /looks');
      assert.equal(where('/ideas'), '→ /looks');
      assert.equal(where('/nowhere'), '→ /looks');
      assert.equal(where('/admin'), '→ /admin/light');
      assert.equal(where('/admin/models'), '→ /admin/light');
      assert.equal(where('/admin/access/'), '→ /admin/light');
      assert.equal(where('/admin/reports'), 'reports {}');
      assert.equal(safeNext(null), '/looks');
    } finally {
      profile.value = 'hosted';
    }
  });

  test('on the Pi, the tutorial takes no step to Ideas', () => {
    const steps = (pi: boolean) => pathsHere(pi).flatMap((p) => p.steps);
    assert.ok(steps(false).some(onIdeas));
    assert.ok(!steps(true).some(onIdeas));
    const idea = pathsHere(true).find((p) => p.id === 'idea')!;
    assert.equal(idea.start, '/studio?tour=idea', 'From an idea starts on its look');
    assert.equal(idea.about, idea.aboutPi);
  });

  test('`next` stays on this app', () => {
    for (const bad of [null, '', 'https://evil.example', '//evil.example', '/login?next=/x']) {
      assert.equal(safeNext(bad), '/ideas', String(bad));
    }
    assert.equal(safeNext('/studio/abc?x=1'), '/studio/abc?x=1');
  });
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
    assert.deepEqual(['Speed (clouds a second)', 'How often (flashes a minute)', 'Drops (a second)'].map(perBeat),
      ['Speed (clouds a beat)', 'How often (flashes a beat)', 'Drops (a beat)'], 'the label reads per beat');
  });

  test('what a control shows: its value, the default, or nothing while bound', () => {
    assert.deepEqual(shownValue(p, {}, 'speed'), { has: false, bound: false, value: 60 });
    assert.deepEqual(shownValue(p, { speed: 90 }, 'speed'), { has: true, bound: false, value: 90 });
    assert.ok(Number.isNaN(shownValue(p, { speed: { mod: 'envelope' } }, 'speed').value));
  });
});

describe('a number as one field, and how a chain is drawn', () => {
  const r = { min: 5, max: 200, step: 1 }, mod = (id: string, kind: Module['kind'], extra: Partial<Module> = {}):
    Module => ({ id, kind, title: id, code: '', params: {}, ...extra });

  test('a value lands on the step from min, within min..max; a drag across the field spans the range', () => {
    assert.deepEqual([snap(90.4, r), snap(999, r), snap(-3, r), snap(0.37, { min: 0, max: 1, step: 0.25 })],
      [90, 200, 5, 0.25]);
    assert.equal(snap(0.01 + 37 * 0.01, { min: 0.01, max: 1, step: 0.01 }), 0.38, 'no float noise');
    assert.deepEqual([decimals(1), decimals(0.05), decimals(1e-7)], [0, 2, 4]);
    assert.deepEqual([scrubTo(60, 50, 100, r), scrubTo(60, -30, 100, r), scrubTo(60, 50, 100, r, true)], [158, 5, 70],
      'half the width: half the range; held to min; Shift: a tenth');
  });

  test('a typed value or a Shift-drag goes between the steps, and the field shows its decimals', () => {
    const fine = { min: 0, max: 2, step: 0.01 };
    assert.deepEqual([exact(0.003, fine), exact(0.0125, fine), exact(9, fine), exact(-1, fine)], [0.003, 0.0125, 2, 0],
      'kept as typed, held to min..max');
    assert.deepEqual([exact(30.6, r), exact(1, r)], [31, 5], 'a whole step (a count) stays whole');
    assert.deepEqual([scrubTo(0, 3, 200, fine, true), scrubTo(0.003, 2, 200, fine, true), scrubTo(0.003, 2, 200, fine)],
      [0.003, 0.005, 0.02], 'Shift: on a grid a tenth of the step, from where it started; else on the step');
    assert.deepEqual([places(0.003, 0.01), places(0.5, 0.01), places(0.0125, 0.01), places(1 / 3, 0.01), places(7, 1)],
      [3, 2, 4, 6, 0]);
    assert.deepEqual([fmt(0.0025), fmt(0.05), fmt(1 / 3), fmt(120.12345)], ['0.0025', '0.05', '0.333', '120.123'],
      'the popover\'s From/To keep a small end');
    assert.deepEqual([onSpan(0.0123456, 0.05), onSpan(0.5004, 1), onSpan(37.26, 100)], [0.01235, 0.5, 37.3],
      'a lane\'s value to a thousandth of its span');
    const drift = { value: 0, min: 0, max: 0.05 }, look = { layers: [], globals: { macros: { drift } },
      automation: { drift: [[0, 0], [16, 0.05]] } } as unknown as Parameters<typeof laneNow>[0];
    assert.deepEqual([laneNow(look, 'drift', drift, 2), laneNow(look, 'drift', drift, 16)], [0.00625, 0.05],
      'an automated macro reads its lane now, not its stored 0');
  });

  test('each module joins the came; each warp and filter reaches everything above it, to a stage\'s start', () => {
    const { first, joins, reaches } = chainWires([mod('a', 'source'), mod('w', 'warp'),
      mod('c', 'source', { as: 'input' }), mod('f', 'filter', { input: 'c' }), mod('b', 'source', { blend: 'max' })]);
    assert.deepEqual([first, joins], [0, ['over', 'warp', 'input', 'filter', 'max']]);
    assert.deepEqual(reaches.map((x) => `${x.kind} ${x.from}-${x.to} ${x.lane}`),
      ['warp 0-1 1', 'filter 0-3 0', 'input 2-3 1'], 'the longest outermost, its input feed dashed inside');
    const trails = { code: "const stage = 'history';" };
    const staged = chainWires([mod('a', 'source'), mod('t', 'filter', trails), mod('b', 'source'),
      mod('w', 'warp'), mod('x', 'filter', { enabled: false }), mod('f', 'filter', { input: 'gone' })]);
    assert.deepEqual(staged.reaches.map((x) => `${x.kind} ${x.from}-${x.to} ${x.lane}`),
      ['filter 0-1 1', 'warp 1-3 1', 'filter 1-5 0'], 'trails ends a stage; an off module reaches nothing');
    assert.deepEqual(chainWires([mod('w', 'warp'), mod('a', 'source', { enabled: false })]), { first: -1,
      joins: ['warp', 'add'], reaches: [] }, 'a warp at the top has nothing above it');
    const blur = { code: "const spatial = 'blur';\nconst stage = 'spatial';" };
    assert.deepEqual([isStageEnd(mod('b', 'filter', blur)), isStageEnd(mod('b', 'source', blur)),
      isStageEnd(mod('b', 'filter', { ref: 'blur' }))], [true, false, false], 'the code says so, not the ref');
  });
});

/** The Studio's state as the timeline uses it: the look, the selection, edits. */
function fakeStudio(layers: Layer[], extra: Partial<Draft> = {}) {
  const look = signal({ id: 'x', title: 'T', summary: '', layers, duration: 30, bpm: null, shared: false, ideaId: null,
    ...extra } as Draft);
  const selectedId = signal<string | null>(layers[0]?.id ?? null);
  const st = {
    look, selectedId, narrow: signal(false), clock: { t: 0, typingUntil: 0 }, data: { rig: null },
    selected: computed(() => look.value.layers.find((l) => l.id === selectedId.value) || null),
    layerById: (id: string) => look.peek().layers.find((l) => l.id === id) || null,
    select: (id: string | null) => { selectedId.value = id; },
    edit: (fn: (l: Draft) => Partial<Draft>) => { look.value = { ...look.value, ...fn(look.value) }; },
    step: () => null, undoStep: () => {},
    editLayer: (id: string, fn: (l: Layer) => Partial<Layer>) => st.edit((L) => ({
      layers: L.layers.map((l) => (l.id === id ? { ...l, ...fn(l) } : l)) })),
  };
  return st as unknown as Studio;
}
const layer = (id: string, clips?: Layer['clips']): Layer => ({ id, title: id, groups: ['g'], blend: 'add', level: 1,
  modules: [{ id: 'm', kind: 'source', title: 'S', code: '', params: {} }], ...(clips ? { clips } : {}) });
const clip = (start: number, end: number) => ({ start, end, fadeIn: 0, fadeOut: 0 });

describe('the timeline on the Studio\'s state', () => {
  test('zoom: fits the view, never past 200 px a second, and spans clips past the end', () => {
    const st = fakeStudio([layer('a', [clip(0, 10), clip(40, 45)])]);
    const tl = createTimeline(st, {} as Preview);
    tl.viewW.value = 900;
    assert.equal(tl.span.value, 45, 'a clip past the look\'s end widens the view');
    assert.equal(tl.pps.value, 20);
    tl.fit.value = false;
    tl.zoomPps.value = 5;
    assert.equal(tl.pps.value, 20, 'never narrower than the fit');
    tl.zoomPps.value = 1000;
    assert.equal(tl.pps.value, 200);
    assert.equal(tl.contentW.value, 9000);
  });

  test('a clip a bar long at the playhead, selected; removing the last makes the layer always on', () => {
    const st = fakeStudio([layer('a')], { bpm: 120 });
    const tl = createTimeline(st, {} as Preview);
    tl.addClipAt(st.selected.peek(), 10.1);
    assert.deepEqual(st.look.peek().layers[0].clips, [clip(10, 12)], 'snapped to ¼ s, a 2 s bar at 120 bpm');
    assert.deepEqual(tl.selected.peek()?.clip, clip(10, 12));
    tl.removeSelected();
    assert.equal(st.look.peek().layers[0].clips, undefined);
    assert.equal(tl.selected.peek(), null);
  });

  test('a drag shows before the look has it; the selection follows the selected layer', () => {
    const st = fakeStudio([layer('a', [clip(0, 4)]), layer('b', [clip(1, 2)])]);
    const tl = createTimeline(st, {} as Preview);
    tl.drag.value = { id: 'a', clips: [clip(2, 6)] };
    assert.deepEqual(tl.clipsOf(st.look.peek().layers[0]), [clip(2, 6)]);
    assert.deepEqual(st.look.peek().layers[0].clips, [clip(0, 4)]);
    tl.selectClip('b', 0);
    assert.equal(st.selectedId.peek(), 'b');
    assert.deepEqual(tl.selected.peek()?.clip, clip(1, 2));
    st.select('a');
    assert.equal(tl.selected.peek(), null, 'another layer: no clip');
  });

  test('without a tempo, beat snapping goes back to the grid', () => {
    const st = fakeStudio([layer('a')], { bpm: 100 });
    const tl = createTimeline(st, {} as Preview);
    tl.setSnap('beat');
    assert.equal(tl.step(), 0.6);
    tl.setBpm(null);
    assert.deepEqual([st.look.peek().bpm, tl.snap.peek(), tl.step()], [null, 'grid', 0.25]);
  });

  test('importing a look appends it after this one, and says why when it cannot', () => {
    const st = fakeStudio([layer('a')]);
    const tl = createTimeline(st, {} as Preview);
    assert.equal(tl.importLook({ title: 'O', duration: 10, layers: [] }), 'That look has no layers.');
    const other = { title: 'O', duration: 10 };
    assert.equal(tl.importLook({ ...other, layers: [layer('z')] }), '');
    const L = st.look.peek();
    assert.equal(L.duration, 40);
    assert.deepEqual(L.layers.map((l) => l.clips), [[clip(0, 30)], [clip(30, 40)]]);
    assert.equal(st.selectedId.peek(), L.layers[1].id);
  });
});

describe('what the sandbox says', () => {
  test('Settings shows what upgrade() changed while the saved value is still what it changed', () => {
    const schema = { direction: {}, often: {} }, up = { direction: ['round', 'clockwise'], often: [undefined, 60],
      gone: [undefined, 1] };
    assert.deepEqual(upgradedOf(up, schema, { direction: 'round' }), { direction: 'clockwise', often: 60 });
    assert.deepEqual(upgradedOf(up, schema, { direction: 'up', often: 30 }), {}, 'edited since: the edit wins');
    assert.deepEqual(upgradedOf('junk', schema, {}), {});
  });

  const m = { id: 'm', kind: 'source' as const, title: 'S', code: 'good', params: {} };
  const L: Layer = { ...layer('a'), modules: [m] };
  const reply = (code: string, ok: boolean) => [{ id: 'a', ok, params: {}, modules: [{ id: 'm', ok, code,
    ...(ok ? { params: { k: { value: 1 } } } : { params: {}, error: 'SyntaxError' }) }] }];

  test('a broken edit keeps the last good code running, once, and says so', () => {
    let look = L;
    const status = createLayerStatus(() => look, () => false);
    assert.equal(status.compiled(reply('good', true)), false);
    assert.equal(status.of('a').kind, 'ok');
    look = { ...L, modules: [{ ...m, code: 'bad' }] };
    assert.equal(status.module('a', look.modules[0]).kind, 'pending');
    assert.equal(status.compiled(reply('bad', false)), true, 'send the look again, with the good code');
    assert.equal(status.codeFor('a', look.modules[0]), 'good');
    assert.deepEqual(status.problem('a', look.modules[0]), { kind: 'compile', message: 'SyntaxError', running: true });
    assert.equal(status.compiled(reply('good', true)), false, 'the good code compiles: no loop');
    assert.equal(status.of('a').kind, 'compile', 'the module is still broken');
    assert.deepEqual(status.params('a', look.modules[0]),
      { schema: { k: { value: 1 } }, note: '', upgraded: undefined });
    look = L;
    assert.equal(status.of('a').kind, 'ok', 'fixed');
  });
});

describe('the pick tile', () => {
  test('a pick read, edited by role, slot and token, and stored back with only what differs', () => {
    const e = readEdit(undefined, 'body/accent');
    assert.deepEqual([e.tokens, e.deal], [['body', 'accent'], true]);
    assert.equal(editValue(e, 'step'), 'body/accent');
    const one = toggleSlot(e, 'body', 2, 4);
    assert.equal(editText(one), 'body1 body3 body4/accent', 'a slot out of a whole role: the others');
    assert.equal(editText(toggleSlot(readEdit(undefined, 'all'), 'accent', 1, 3)), 'accent1', 'over all: just it');
    assert.equal(editText(toggleRole(one, 'body')), 'body/accent', 'the whole role back, in its place');
    assert.equal(editText({ ...toggleToken(one, '#ff0000'), deal: false }), 'body1 body3 body4 accent #ff0000');
    assert.equal(editValue(toggleRole(toggleRole(e, 'body'), 'accent'), 'step'), undefined, 'nothing: the default');
    const opts = readEdit({ pick: 'all', blend: 'smooth', range: [0.2, 0.8], rotate: { mod: 'lfo', rate: 1 } }, 'low');
    assert.deepEqual(editValue(opts, 'smooth'), { pick: 'all', range: [0.2, 0.8], rotate: { mod: 'lfo', rate: 1 } });
    assert.deepEqual(editValue({ ...opts, blend: 'step', range: [0, 1], rotate: undefined }, 'smooth'),
      { pick: 'all', blend: 'step' });
    assert.deepEqual(readEdit('banana', 'high').tokens, ['high'], 'a bad value: the default');
  });

  test('a custom colour is added once, at the end, up to 4, in place of the whole palette or rainbow', () => {
    const red = addColour(readEdit(undefined, 'all'), '#ca1c1c');
    assert.equal(editValue(red, 'step'), '#ca1c1c', 'over all: just it, so it plays');
    assert.equal(editText(addColour(readEdit('rainbow body2', 'all'), '#00ff00')), 'body2 #00ff00');
    assert.equal(editText(addColour(red, '#ca1c1c')), '#ca1c1c', 'already there: kept once');
    assert.equal(editText(addColour(red, '#0000ff')), '#ca1c1c #0000ff');
    const four = ['#000001', '#000002', '#000003'].reduce(addColour, red);
    assert.equal(editText(addColour(four, '#ffffff')), editText(four), `at ${CUSTOM_MAX}: no more`);
    const five = '#000001 #000002 #000003 #000004 #000005 low';
    assert.equal(editText(addColour(readEdit(five, 'all'), '#ffffff')), five, 'more from code: kept as they are');
  });
});

describe('the idea form\'s gate (idea-access.tsx)', () => {
  const sol = { id: 'sol', label: 'Sol', paid: true }, free = { id: 'free', label: 'Free', paid: false };
  const access = (o = {}) => ({ unlocked: true, exempt: false, inviteOnly: true,
    limits: { perHour: 6, perDay: 20, concurrent: 2 }, left: { hour: 4, day: 15, running: 2 }, ...o });
  test('free models and admins pass; locked shows the lock; open says what is left', () => {
    assert.equal(gateOf(access({ unlocked: false }), free).kind, 'free');
    assert.equal(gateOf(access({ exempt: true }), sol).kind, 'exempt');
    assert.equal(gateOf(access({ unlocked: false }), sol).kind, 'locked');
    assert.deepEqual(gateOf(access({ models: { sol: { day: 2 } } }), sol), { kind: 'open',
      text: '4 left this hour · 2 today' });
  });
  test('at a limit: the wait, and when the next idea may go', () => {
    const now = new Date(2026, 9, 19, 10, 0), at = new Date(2026, 9, 19, 10, 40).toISOString();
    const wait = gateOf(access({ left: { hour: 0, day: 3, running: 2 }, nextAt: at }), sol, now);
    assert.equal(wait.kind, 'wait');
    assert.match((wait as { text: string }).text, /^That's all your ideas for this hour\. Next idea at .*40/);
    const next = new Date(2026, 9, 20, 9).toISOString();
    const tomorrow = gateOf(access({ left: { hour: 2, day: 0, running: 2 }, nextAt: next }), sol, now);
    assert.match((tomorrow as { text: string }).text, /today\. Next idea tomorrow at/);
    assert.match((gateOf(access({ left: { hour: 2, day: 2, running: 0 } }), sol) as { text: string }).text,
      /being made/);
    assert.match((gateOf(access({ full: true }), sol) as { text: string }).text, /done all they can/);
    const zero = access({ limits: { perHour: 0, perDay: 20, concurrent: 2 }, left: { hour: 0, day: 20, running: 2 } });
    assert.deepEqual(gateOf(zero, sol), { kind: 'wait', text: 'Your allowance for the AI models is 0: ask an admin.' });
  });
});
