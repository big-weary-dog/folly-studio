// The UI's logic that decides behaviour, without a browser: routing (redirects and `next`), the modulate dialog's
// bindings, the scrub field's values and how a chain is drawn, the pick tile's edits, the timeline's zoom and edits on
// the Studio's state, and the sandbox status (a broken edit keeps the last good code running). The views themselves
// are checked in a browser (`npm run smoke`).
import assert from 'node:assert/strict';

import { computed, signal } from '@preact/signals';
import { describe, test } from 'vitest';

import { resolve, safeNext } from '../public/js/ui/app.tsx';
import {
  bindingForm, bindingText, makeBinding, normaliseParam, type Param, shownValue,
} from '../public/js/ui/bindings.ts';
import { decimals, scrubTo, snap } from '../public/js/ui/kit.tsx';
import { createLayerStatus } from '../public/js/ui/layer-status.ts';
import {
  editText, editValue, readEdit, roleState, toggleRole, toggleSlot, toggleToken,
} from '../public/js/ui/pick-model.ts';
import type { Preview } from '../public/js/ui/preview.ts';
import type { Draft, Studio } from '../public/js/ui/studio-store.ts';
import { createTimeline } from '../public/js/ui/timeline-state.ts';
import { chainWires, isStageEnd, type Layer } from '../public/js/ui/model.ts';
import type { Module } from '../shared/schemas/look.ts';

const where = (path: string, search = '', signedIn = true) => {
  const r = resolve(path, search, signedIn);
  return 'redirect' in r ? `→ ${r.redirect}` : `${r.route.name} ${JSON.stringify(r.params)}`;
};

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
    const lfo = makeBinding({ ...bindingForm({}, p, globals), mod: 'lfo', rate: 'fast', depth: '' }, p);
    assert.deepEqual(lfo, { mod: 'lfo', shape: 'sine', rate: 1, unit: 'hz', center: 60, depth: 48.75 });
    assert.equal(makeBinding({ ...f, mod: '' }, p), null, 'nothing: its field sets it');
    assert.equal(bindingText(lfo!), 'LFO sine · 1 Hz');
    assert.equal(bindingText({ mod: 'global', name: 'storm', from: 20, to: 160 }), 'storm → 20–160');
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
    assert.deepEqual(status.params('a', look.modules[0]), { schema: { k: { value: 1 } }, note: '' });
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
    assert.deepEqual(roleState(one, 'body'), { whole: false, slots: new Set([1, 3, 4]) });
    assert.equal(editText(toggleRole(one, 'body')), 'body/accent', 'the whole role back, in its place');
    assert.equal(editText({ ...toggleToken(one, '#ff0000'), deal: false }), 'body1 body3 body4 accent #ff0000');
    assert.equal(editValue(toggleRole(toggleRole(e, 'body'), 'accent'), 'step'), undefined, 'nothing: the default');
    const opts = readEdit({ pick: 'all', blend: 'smooth', range: [0.2, 0.8], rotate: { mod: 'lfo', rate: 1 } }, 'low');
    assert.deepEqual(editValue(opts, 'smooth'), { pick: 'all', range: [0.2, 0.8], rotate: { mod: 'lfo', rate: 1 } });
    assert.deepEqual(editValue({ ...opts, blend: 'step', range: [0, 1], rotate: undefined }, 'smooth'),
      { pick: 'all', blend: 'step' });
    assert.deepEqual(readEdit('banana', 'high').tokens, ['high'], 'a bad value: the default');
  });
});
