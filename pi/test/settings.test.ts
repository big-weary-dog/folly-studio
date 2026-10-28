import assert from 'node:assert/strict';
import { test } from 'vitest';
import { compileLayer, prepareLayer, prepareScene, renderFrame } from '../../public/js/pattern-core.ts';
import { mapEvery } from '../../public/js/core/tree.ts';
import { liveLook } from '../src/controls.ts';
import { FromPage } from '../src/protocol.ts';
import { engineOn, lib, oneModule, rig } from './fixture.ts';
import { resolveLook } from '../src/library.ts';
import type { LayerInput } from '../../public/js/pattern-core.ts';
import { createRelay } from '../src/relay.ts';

const offered = () => resolveLook({ id: 'offered', title: 'Offered', layers: [{ id: 'layer', title: 'Layer',
  modules: [{ id: 'chase', title: 'Chase', kind: 'source', ref: 'single-strand', params: { colours: '#ff0000' },
    live: ['mode', 'colours', 'speed', 'gone'] }] }] }, lib);
const name = (key: string) => JSON.stringify(['layer', 'chase', key]);

test('a saved short hex stays the default, source and released colour', () => {
  const own = offered();
  own.layers[0].modules![0].params!.colours = '#f00';
  const scene = prepareScene(rig), layers = own.layers.map((l) => prepareLayer(scene, l, compileLayer(l)));
  const live = liveLook(own, undefined, layers, scene), rgb = new Float32Array(scene.count * 3);
  renderFrame(scene, layers, 0, rgb, live.look);
  const initial = Float32Array.from(rgb);
  assert.equal(live.controls.find((c) => c.name === name('colours'))!.default, '#f00');
  assert.equal(live.layers()[0].modules![0].params!.colours, '#f00');
  live.set(name('colours'), 'body', 0);
  live.releaseAll(0);
  renderFrame(scene, layers, 0, rgb, live.look);
  assert.deepEqual(rgb, initial);
  assert.equal(live.layers()[0].modules![0].params!.colours, '#f00');
  const r = engineOn([own]); r.engine.play('offered'); r.run(5);
  r.engine.set(name('colours'), 'accent');
  r.engine.jukebox();
  assert.equal((r.engine.source()!.layers[0] as LayerInput).modules![0].params!.colours, '#f00');
});

test('only creator-offered eligible params appear; IDs survive rename/reorder, disabled parents offer none', () => {
  const r = engineOn([offered(), oneModule('old', 'single-strand')]);
  r.engine.play('old'); r.run(5);
  assert.deepEqual(r.engine.state().look!.controls.map((c) => c.kind), ['palette']);
  r.engine.play('offered'); r.run(5);
  const controls = r.engine.state().look!.controls;
  assert.deepEqual(controls.map((c) => c.kind), ['choice', 'color', 'palette']);
  assert.deepEqual(controls.slice(0, 2).map((c) => c.name), [name('mode'), name('colours')]);
  const moved = offered();
  moved.layers[0].title = 'Renamed';
  moved.layers[0].modules![0].title = 'Another name';
  moved.layers.unshift({ id: 'other', modules: [{ id: 'bed', ref: 'colour-wash' }] });
  const changed = engineOn([resolveLook(moved, lib)]);
  changed.engine.play('offered'); changed.run(5);
  assert.deepEqual(changed.engine.state().look!.controls.slice(0, 2).map((c) => c.name),
    [name('mode'), name('colours')]);
  moved.layers[1].modules![0].enabled = false;
  const disabled = engineOn([resolveLook(moved, lib)]);
  disabled.engine.play('offered'); disabled.run(5);
  assert.deepEqual(disabled.engine.state().look!.controls.map((c) => c.kind), ['palette']);
});

test('typed changes update pixels and sources, refuse invalid values, and restore the untouched look', () => {
  const own = offered(), before = structuredClone(own), scene = prepareScene(rig);
  const layers = own.layers.map((l) => prepareLayer(scene, l, compileLayer(l)));
  const live = liveLook(own, undefined, layers, scene), rgb = new Float32Array(scene.count * 3);
  const frame = () => { renderFrame(scene, layers, 0, rgb, live.look); return Float32Array.from(rgb); };
  const initial = frame();
  assert.ok(live.set(name('colours'), '#0000ff', 0));
  const blue = frame();
  assert.notDeepEqual(blue, initial);
  assert.ok(blue.some((v, i) => i % 3 === 2 && v > 0));
  assert.ok(live.set(name('mode'), 'bounce', 0));
  assert.equal(layers[0].all.find((m) => m.id === 'chase')!.P.mode, 'bounce');
  const rev = live.settingsRevision;
  for (const v of [42, 'nope', { pick: 'not-a-role' }, [2, 0, 0]]) {
    assert.equal(live.set(name('colours'), v as never, 0), false);
    assert.equal(live.set(name('mode'), v as never, 0), false);
  }
  assert.equal(live.settingsRevision, rev);
  live.releaseAll(0);
  live.step(0.5, 0.5);
  assert.deepEqual(frame(), initial);
  assert.deepEqual(own, before);
  const number = oneModule('number', 'clouds', {}, {
    globals: { macros: { drive: { value: 0.5, min: 0, max: 1 } } },
  });
  const r = engineOn([own, number]); r.engine.play('number'); r.run(5);
  assert.equal(r.engine.set('drive', 'loud'), false, 'a number control refuses a string');
  assert.equal(r.engine.state().look!.controls.find((c) => c.name === 'drive')!.value, 0.5);
  r.engine.play('offered'); r.run(5);
  assert.equal(r.engine.set(name('mode'), 42), false, 'a choice refuses a number');
  assert.equal(r.engine.state().look!.controls.find((c) => c.name === name('mode'))!.value, 'along');
  const sourceRev = r.engine.source()!.rev;
  assert.ok(r.engine.set(name('colours'), { pick: 'accent', blend: 'smooth' }));
  assert.ok(r.engine.source()!.rev > sourceRev);
  assert.deepEqual((r.engine.source()!.layers[0] as LayerInput).modules![0].params!.colours,
    { pick: 'accent', blend: 'smooth' });
  r.engine.jukebox();
  assert.equal((r.engine.source()!.layers[0] as LayerInput).modules![0].params!.colours, '#ff0000');
});

test('protocol accepts typed settings; attached offers use their real link and source params', () => {
  assert.ok(FromPage.safeParse({ type: 'set', name: name('colours'), value: [0.2, 0.3, 0.4] }).success);
  assert.equal(FromPage.safeParse({ type: 'set', name: name('colours'), value: [2, 0, 0] }).success, false);
  const look = offered();
  look.layers[0].modules!.push({ id: 'spin', ref: 'rotate', kind: 'warp', on: 'chase' });
  const r = engineOn([resolveLook(look, lib)]); r.engine.play('offered'); r.run(5);
  assert.ok(r.engine.set(name('mode'), 'in'));
  let value: unknown;
  mapEvery((r.engine.source()!.layers[0] as LayerInput).modules!, (m) => {
    if (m.id === 'chase') value = m.params!.mode;
    return m;
  });
  assert.equal(value, 'in');
});

test('choice changes and releases mix the affected layer, with continuous interrupted switches', () => {
  const own = offered();
  own.layers[0].modules![0].code = `const params = {mode:{type:'choice', options:['along','bounce','in','off'],
    value:'along'}}; function pixel(p,t,P){
    return P.mode==='off'?null:P.mode==='along'?[1,0,0]:P.mode==='bounce'?[0,1,0]:[0,0,1]}`;
  delete own.layers[0].modules![0].ref;
  const scene = prepareScene(rig), layers = own.layers.map((l) => prepareLayer(scene, l, compileLayer(l)));
  const live = liveLook(own, undefined, layers, scene), rgb = new Float32Array(scene.count * 3);
  const draw = () => { renderFrame(scene, layers, 0, rgb, live.look); return Array.from(rgb.slice(0, 3)); };
  const red = draw();
  live.set(name('mode'), 'bounce', 0);
  assert.deepEqual(draw(), red);
  live.step(0.25, 0.25);
  const mixed = draw();
  assert.ok(mixed[0] > 0 && mixed[1] > 0);
  live.set(name('mode'), 'in', 0.25);
  assert.deepEqual(draw(), mixed);
  live.step(0.5, 0.25);
  assert.ok(draw().every((v) => v > 0));
  live.step(0.75, 0.25);
  const blue = draw();
  assert.equal(blue[0], 0); assert.equal(blue[1], 0); assert.ok(blue[2] > 0);
  live.release(name('mode'), 0.75);
  assert.deepEqual(draw(), blue);
  live.step(1, 0.25);
  assert.ok(draw()[0] > 0 && draw()[2] > 0);
  live.step(1.25, 0.25);
  assert.deepEqual(draw(), red);
  live.set(name('mode'), 'off', 1.25);
  live.step(1.5, 0.25);
  assert.ok(Math.abs(draw()[0] - red[0] / 2) < 1e-6, 'transparent choices blend premultiplied colour');
  live.step(1.75, 0.25);
  assert.deepEqual(draw(), [0, 0, 0]);
});

test('both choices advance independent state while an unaffected layer stays intact', () => {
  const own = offered();
  own.layers[0].modules![0].code = `const params={mode:{type:'choice',options:['along','bounce'],value:'along'}};
    let ticks=0; function frame(){ticks++} function pixel(p,t,P){
    return P.mode==='along'?[ticks/100,0,0]:[0,ticks/100,0]}`;
  delete own.layers[0].modules![0].ref;
  own.layers.push({ id: 'bed', modules: [{ code: 'function pixel(){return [0,0,0.2]}' }] });
  const scene = prepareScene(rig), layers = own.layers.map((l) => prepareLayer(scene, l, compileLayer(l)));
  const live = liveLook(own, undefined, layers, scene), rgb = new Float32Array(scene.count * 3);
  const draw = () => { renderFrame(scene, layers, 0, rgb, live.look); return Array.from(rgb.slice(0, 3)); };
  const initial = draw();
  live.set(name('mode'), 'bounce', 0);
  live.step(0.25, 0.25);
  const middle = draw();
  assert.ok(Math.abs(middle[0] - initial[0]) < 1e-6, 'old instance advances from its existing state');
  assert.ok(Math.abs(middle[1] - initial[0] / 2) < 1e-6, 'new instance has independent state');
  assert.equal(middle[2], initial[2]);
  live.step(0.5, 0.25);
  const final = draw();
  assert.equal(final[0], 0);
  assert.ok(Math.abs(final[1] - initial[0] * 2) < 1e-6);
  assert.equal(final[2], initial[2]);
});

test('a choice switch keeps passing relayed frames instead of substituting a local render', () => {
  const relay = createRelay({ count: rig.count, fps: 40, now: () => 0 }), who = {};
  const r = engineOn([offered()], undefined, undefined, relay);
  r.engine.play('offered'); r.run(2);
  relay.start(who, 'custom renderer');
  const frame = new Uint8Array(relay.bytes), view = new DataView(frame.buffer);
  for (let i = 0; i < rig.count * 3; i++) view.setUint16(8 + i * 2, i % 3 === 2 ? 20000 : 0, true);
  const tick = () => {
    view.setUint32(0, r.engine.stats.frames, true);
    view.setUint32(4, r.engine.state().look!.rev, true);
    assert.equal(relay.push(who, frame), '');
    r.engine.tick();
  };
  tick();
  const initial = Uint8Array.from(r.last());
  assert.ok(initial.some((v) => v > 0));
  r.engine.set(name('mode'), 'bounce');
  for (let i = 0; i < 20; i++) { tick(); assert.deepEqual(r.last(), initial); }
  r.engine.release(name('mode'));
  tick(); assert.deepEqual(r.last(), initial);
  r.engine.close();
});

test('colour picks remain immediate on both sides of a choice fade', () => {
  const own = offered();
  own.layers[0].modules![0].code = `const params={mode:{type:'choice',options:['along','bounce'],value:'along'},
    colours:{type:'color',value:'#ff0000'}}; function pixel(){return swatch('colours',0)}`;
  delete own.layers[0].modules![0].ref;
  const scene = prepareScene(rig), layers = own.layers.map((l) => prepareLayer(scene, l, compileLayer(l)));
  const live = liveLook(own, undefined, layers, scene), rgb = new Float32Array(scene.count * 3);
  const draw = () => { renderFrame(scene, layers, 0, rgb, live.look); return Array.from(rgb.slice(0, 3)); };
  const initial = draw();
  live.set(name('mode'), 'bounce', 0); live.step(0.25, 0.25);
  draw();
  live.set(name('colours'), '#0000ff', 0.25);
  assert.deepEqual(draw(), [0, 0, initial[0]]);
  live.release(name('colours'), 0.25);
  assert.deepEqual(draw(), initial);
  live.set(name('mode'), 'along', 0.25);
  live.set(name('colours'), '#0000ff', 0.25);
  assert.deepEqual(draw(), initial, 'an interrupted fade holds its existing mixture');
  live.step(0.5, 0.25);
  const held = draw();
  assert.ok(held[0] > 0 && held[2] > 0, 'the held mixture fades into the recoloured live render');
  live.step(0.75, 0.25);
  assert.deepEqual(draw(), [0, 0, initial[0]]);
});

test('an outgoing choice failure reaches the frame errors with its module identity', () => {
  const own = offered();
  own.layers[0].modules![0].code = `const params={mode:{type:'choice',options:['along','bounce'],value:'along'}};
    function frame(t,P){if(t>=0.2 && P.mode==='along')throw Error('outgoing failed')}
    function pixel(){return [1,0,0]}`;
  delete own.layers[0].modules![0].ref;
  const scene = prepareScene(rig), layers = own.layers.map((l) => prepareLayer(scene, l, compileLayer(l)));
  const live = liveLook(own, undefined, layers, scene), rgb = new Float32Array(scene.count * 3);
  renderFrame(scene, layers, 0, rgb, live.look);
  live.set(name('mode'), 'bounce', 0); live.step(0.25, 0.25);
  const result = renderFrame(scene, layers, 0.25, rgb, live.look);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].module, 'chase');
  assert.match(result.errors[0].error, /outgoing failed/);
  assert.ok(rgb.every((v) => v === 0), 'a failing layer adds nothing');
});
