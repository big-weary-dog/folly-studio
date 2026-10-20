// pi/src/controls.ts: a look's live controls ease to a push, keep the look's clock and beat continuous, take a tapped
// tempo, and free an automated name from its lane at the first push.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { BPM, controlsOf, liveLook, SLEW } from '../src/controls.ts';
import { oneModule, shipped } from './fixture.ts';

const dt = 1 / 40;
const heartbeat = shipped().get('heartbeat-plasma')!.look!;
/** Steps `live` from show time t for `secs`; the time it got to. */
const play = (live: ReturnType<typeof liveLook>, t: number, secs: number) => {
  for (let i = 0; i < Math.round(secs / dt); i++, t += dt) live.step(t, dt);
  return t;
};
const clock = (L: ReturnType<typeof liveLook>['look'], t: number) => L.offset + L.g.speed * t;
const beats = (L: ReturnType<typeof liveLook>['look'], t: number) => (t - L.beat0) * L.bpm / 60;

describe('a look\'s controls', () => {
  test('are its globals.live, in order, with their ranges and values', () => {
    const live = liveLook(heartbeat);
    assert.deepEqual(live.controls.map((c) => c.name), ['bpm', 'drive', 'ripple', 'hue', 'level']);
    assert.deepEqual(live.controls[0], { name: 'bpm', ...BPM, value: 120, kind: 'bpm' });
    assert.equal(live.controls[1]!.kind, 'macro');
  });

  test('without globals.live, its macros and level', () => {
    const look = oneModule('m', 'clouds', {}, { globals: { macros: { a: { value: 0.2 } } } });
    assert.deepEqual(controlsOf(look, liveLook(look).look).map((c) => c.name), ['a', 'level']);
  });

  test('a push eases there over SLEW seconds, clamped to the range; unknown names are refused', () => {
    const live = liveLook(heartbeat);
    assert.equal(live.set('level', 0, 0), true);
    play(live, 0, SLEW / 2);
    assert.ok(Math.abs(live.values().level! - 0.5) < 0.05, `${live.values().level}`);
    play(live, SLEW / 2, SLEW);
    assert.equal(live.values().level, 0);
    live.set('level', 7, 1);
    play(live, 1, 1);
    assert.equal(live.values().level, 1);
    assert.equal(live.set('nope', 1, 0), false);
    assert.equal(live.set('level', NaN, 0), false);
  });
});

describe('time and tempo', () => {
  const look = oneModule('s', 'clouds', {}, { globals: { live: ['speed', 'bpm'] } });

  test('a speed change keeps the pattern clock where it is', () => {
    const live = liveLook(look);
    let t = 5;
    live.look.lastT = t;
    const before = clock(live.look, t);
    live.set('speed', 3, t);
    t = play(live, t, 1);
    live.look.lastT = t;
    assert.equal(live.look.g.speed, 3);
    // Across the ease the clock only ever moved forward, by no more than the fastest speed allowed.
    assert.ok(clock(live.look, t) > before && clock(live.look, t) - before < 3.05, `${clock(live.look, t) - before}`);
  });

  test('a bpm change keeps the beat\'s phase', () => {
    const live = liveLook(look);
    live.look.lastT = 10;
    const phase = beats(live.look, 10);
    live.set('bpm', 90, 10);
    play(live, 10, 2 * SLEW);
    assert.equal(live.look.bpm, 90);
    assert.ok(Math.abs(beats(live.look, 10) - phase) < 1e-9);
  });

  test('taps set the downbeat and, from two, the tempo between them; a pause starts afresh', () => {
    const live = liveLook(look);
    assert.equal(live.tap(3, 1000), 120);
    assert.equal(live.look.beat0, 3);
    live.tap(3.5, 1500);
    assert.equal(live.tap(4, 2000), 120);
    assert.equal(live.tap(4.4, 2400), 128.6);   // the mean over every tap in the run: 3 beats in 1.4 s
    assert.equal(live.tap(20, 9000), 128.6);
    assert.equal(live.tap(20.6, 9600), 100);
    assert.equal(live.controls.find((c) => c.name === 'bpm')!.value, 100);
    live.tap(30, 20000);
    assert.equal(live.tap(30.1, 20100), BPM.max);
  });

  test('the loop wrapping back keeps the beat going', () => {
    const live = liveLook(look);
    live.tap(1, 0);
    const b = beats(live.look, 31);
    live.wrapped(30);
    assert.equal(beats(live.look, 1), b);
  });
});

describe('an automated name', () => {
  const look = oneModule('a', 'clouds', {}, {
    globals: { macros: { drive: { value: 0, min: 0, max: 1 } }, live: ['drive'] },
    automation: { drive: [[0, 0], [10, 1]] },
  });

  test('follows its lane until pushed, then leaves it from the lane\'s value', () => {
    const live = liveLook(look);
    assert.ok(Math.abs(live.look.normAt('drive', 5) - 0.5) < 1e-9);
    live.look.lastT = 5;
    live.set('drive', 0.5, 5);
    assert.ok(Math.abs(live.values().drive! - 0.5) < 1e-9);
    assert.equal(live.look.lanes.length, 0);
    assert.equal(live.look.normAt('drive', 9), 0.5);
  });
});

describe('a modulator', () => {
  const saw = { mod: 'lfo', shape: 'saw', rate: 0.25, center: 0.5, depth: 0.5 };
  const look = oneModule('m', 'clouds', {}, { globals: { macros: {
    storm: { value: 1, min: 0, max: 4 }, gust: { value: 0, min: 0, max: 1, mod: saw },
    wobble: { value: 0, min: 0, max: 1, mod: { ...saw, pace: 'storm' } } } } });

  test('is not a default control; listed in globals.live, a push holds it and the others keep moving', () => {
    assert.deepEqual(liveLook(look).controls.map((c) => c.name), ['storm', 'level']);
    const live = liveLook({ ...look, globals: { ...look.globals, live: ['gust'] } });
    live.look.lastT = 1;
    live.set('gust', 0.9, 1);
    assert.ok(Math.abs(live.look.normAt('gust', 3) - 0.25) < 1e-9, 'held where it was (¼ cycle) until it eases');
    play(live, 1, SLEW * 2);
    assert.equal(live.look.normAt('gust', 3), 0.9);
    assert.ok(live.look.g.macros.find((m) => m.name === 'wobble')!.mod, 'the others keep their mods');
  });

  test('a push on the fader that paces it keeps its phase', () => {
    const live = liveLook(look), at = (t: number) => live.look.normAt('wobble', t);
    const t = play(live, 0, 2), before = at(t);
    live.set('storm', 4, t);
    live.step(t, SLEW);
    assert.equal(live.values().storm, 4);
    assert.ok(Math.abs(at(t) - before) < 1e-9, `${at(t)} vs ${before}`);
    assert.ok(Math.abs(at(t + 0.1) - before - 0.1) < 1e-9, 'then four times as fast');
  });
});
