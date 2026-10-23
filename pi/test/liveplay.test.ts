// What Live Play adds to the engine (SPEC-liveplay): a change fades over the time it gives, queued items say how
// long they play, a released control glides back to the look's own value, and the palette knob blends in place.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { newPicks } from '../../public/js/core/picks.ts';
import { paletteColours, RUN } from '../../public/js/core/stdlib.ts';
import { liveLook, SLEW } from '../src/controls.ts';
import { BLEND, paletteBlend, paletteNamed } from '../src/palette.ts';
import { engineOn, oneModule } from './fixture.ts';

const wash = oneModule('wash', 'colour-wash', { colours: 'body1', speed: 0 });
const first = (r: ReturnType<typeof engineOn>) => {
  const k = r.engine.scene.addr[0]!, o = r.engine.scene.order;
  return [0, 1, 2].map((c) => r.last()[k + o[c]!]!);
};

describe('changes', () => {
  test.each([1, 2.2])('a 4 s crossfade overlaps LED light at gamma %s and completes in 4 s', (gamma) => {
    const red = oneModule('red', 'colour-wash', { colours: '#ff0000', speed: 0 });
    const blue = oneModule('blue', 'colour-wash', { colours: '#0000ff', speed: 0 }, { duration: 1 });
    const r = engineOn([red, blue], { gamma });
    r.engine.play('red');
    r.run(1);
    r.engine.play('blue', 4);
    r.run(2);
    const [r0, g0, b0] = first(r);
    assert.ok(Math.abs(r0 - 127.5) <= 1 && g0 === 0 && Math.abs(b0 - 127.5) <= 1, `${first(r)}`);
    r.run(2);
    assert.deepEqual(first(r), [0, 0, 255]);
    assert.equal(r.engine.state().look?.id, 'blue');
    r.engine.queue('fire', 'end');
    r.engine.next(0.25);
    r.run(0.3);
    assert.equal(r.engine.state().look?.id, 'fire');
  });

  test('interrupting a crossfade starts from the mixture on the lights', () => {
    const looks = ['red', 'blue', 'green'].map((id, i) => oneModule(id, 'colour-wash',
      { colours: ['#ff0000', '#0000ff', '#00ff00'][i], speed: 0 }));
    const r = engineOn(looks, { gamma: 1 });
    r.engine.play('red');
    r.run(1);
    r.engine.play('blue', 4);
    r.run(2);
    r.engine.play('green', 4);
    r.engine.tick();
    const [red, green, blue] = first(r);
    assert.ok(red > 120 && blue > 120 && green < 5, `${first(r)}`);
  });
});

describe('controls', () => {
  test('a release glides back to the look\'s own value; held says who moved it', () => {
    const look = oneModule('m', 'clouds', {}, { globals: { macros: { a: { value: 0.2 } }, live: ['a', 'bpm'] } });
    const live = liveLook(look), a = () => live.controls.find((c) => c.name === 'a')!;
    live.set('a', 0.9, 0);
    for (let t = 0; t < 1; t += 0.025) live.step(t, 0.025);
    assert.deepEqual([a().value, a().held, a().default], [0.9, true, 0.2]);
    live.tap(1, 0);
    live.tap(1.5, 500);
    assert.equal(live.controls.find((c) => c.name === 'bpm')!.held, true);
    live.releaseAll(2);
    for (let t = 2; t < 2 + SLEW * 40; t += 0.025) live.step(t, 0.025);
    assert.deepEqual([a().value, a().held, live.look.bpm], [0.2, false, 120]);
  });
});

describe('the palette knob', () => {
  test('blends to the new palette over BLEND seconds, then is it; back to the look\'s own the same way', () => {
    const r = engineOn([wash], { gamma: 1 });
    r.engine.play('wash');
    r.run(1.2);
    assert.deepEqual(first(r), [255, 51, 60]);    // chapel's body1
    const rev = r.engine.source()!.rev;
    assert.equal(r.engine.palette('aqua'), true);
    assert.equal(r.engine.palette('nope'), false);
    r.run(BLEND / 2);
    const mid = first(r);
    assert.ok(mid[0]! < 255 && mid[0]! > 0 && mid[2]! > 60 && mid[2]! < 224, `${mid}`);
    r.run(BLEND / 2 + 0.1);
    assert.deepEqual(first(r), [0, 180, 224]);    // aqua's body1
    const s = r.engine.state().look!.controls.at(-1)!;
    assert.deepEqual([s.name, s.value, s.default, s.held], ['palette', 'aqua', 'chapel', true]);
    const src = r.engine.source()!;
    assert.ok(src.rev > rev);
    assert.equal(src.globals!.palette!.name, 'aqua');
    r.engine.release('palette');
    r.run(BLEND + 0.1);
    assert.deepEqual(first(r), [255, 51, 60]);
    assert.equal(r.engine.state().look!.controls.at(-1)!.held, false);
  });

  test('a blend starts from the colours showing, and changes them in place', () => {
    const chapel = paletteColours({ name: 'x', body: ['#ff0000', '#0000ff'] })!, aqua = paletteNamed('aqua')!;
    const b = paletteBlend(chapel, aqua);
    assert.equal(b.palette.body.length, aqua.body.length);
    assert.deepEqual(b.palette.body[0], [1, 0, 0]);
    const stop = b.palette.body[0];
    b.step(BLEND / 2);
    assert.equal(b.palette.body[0], stop, 'the same array');
    assert.notDeepEqual(stop, [1, 0, 0]);
    assert.equal(b.step(BLEND), aqua);
  });

  test('a module\'s colour param follows a palette blending in place', () => {
    const picks = newPicks(), P: Record<string, unknown> = {};
    const b = paletteBlend(paletteNamed('chapel')!, paletteNamed('aqua')!);
    RUN.palette = b.palette;
    picks.bind({ c: { type: 'color', value: 'body1' } } as never, {}, P as never);
    const before = [...(P.c as number[])];
    b.step(BLEND / 2);
    picks.frame();
    assert.notDeepEqual(P.c, before);
    assert.deepEqual(P.c, [...b.palette.body[0]!]);
    RUN.palette = paletteNamed('chapel')!;
  });
});
