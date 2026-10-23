// pi/src/engine.ts and run.ts: switches dip through black, a strobe trips the flash guard down to the safe look until
// someone picks one, blackout and the master fade, a look that cannot play falls back to safe, and the timer keeps
// to the clock.
import assert from 'node:assert/strict';

import { afterEach, beforeEach, describe, test, vi } from 'vitest';

import { lightOf } from '../../public/js/core/light.ts';
import { createEngine, FADE } from '../src/engine.ts';
import { runLoop } from '../src/run.ts';
import { engineOn, lib, oneModule, rig, shipped } from './fixture.ts';

const strobe = oneModule('strobe', 'strobe', { speed: 12 });

test('the safe look must prepare before an engine can start', () => {
  const looks = shipped();
  looks.get('safe')!.look!.layers[0]!.modules![0]!.code = 'invalid js(';
  assert.throws(() => createEngine({ rig, lib, looks: () => looks, safe: 'safe', output: () => {
    assert.fail('startup must not output');
  } }), /the safe look safe cannot play/);
});

test('if the prepared safe spare is spent and safe breaks or disappears, the fallback is black', () => {
  for (const missing of [false, true]) {
    const bad = oneModule('bad', 'clouds');
    bad.layers[0]!.modules![0]!.code = 'invalid js(';
    const r = engineOn([bad]);
    r.engine.play('bad');
    r.run(0.1); // consume the prepared safe spare
    if (missing) r.looks.delete('safe');
    else r.looks.get('safe')!.look!.layers[0]!.modules![0]!.code = 'invalid js(';
    r.engine.play('bad');
    r.run(3);
    assert.equal(r.engine.state().look?.id, 'black');
    assert.equal(r.lit(), 0);
  }
});

test('the guard counts skipped slots through stalls, loops and switches without accelerating a 2 Hz strobe', () => {
  const slow = oneModule('slow', 'strobe', { speed: 2, length: 0.5, fade: 0, colours: '#ffffff' }, { duration: 2 });
  for (const skipped of [0, 1]) {
    const r = engineOn([slow]);
    for (let round = 0; round < 2; round++) {
      r.engine.play('slow', 0);
      for (let i = 0; i < 160; i++) {
        r.engine.skip(skipped + (i === 80 ? 200 : 0));
        r.engine.tick();
      }
      assert.equal(r.engine.state().tripped, null);
      assert.equal(r.engine.state().look?.id, 'slow');
    }
  }
});

describe('the engine', () => {
  test('a switch fades out and in, and starts the new look from its top', () => {
    const r = engineOn();
    r.engine.play('fire');
    r.run(2);
    assert.equal(r.engine.state().look?.id, 'fire');
    assert.equal(r.engine.play('beat-bars'), true);
    assert.equal(r.engine.state().switching?.id, 'beat-bars');
    r.run(FADE.queue / 2);
    assert.ok(Math.abs(r.engine.state().gain - 0.5) < 0.05, `${r.engine.state().gain}`);
    r.run(FADE.queue / 2 + 0.05);
    assert.equal(r.engine.state().look?.id, 'beat-bars');
    assert.ok(r.engine.state().look!.t < 0.1);
    assert.equal(r.engine.play('nope'), false);
  });

  test('the LEDs get the output transform: v^gamma, and the master as a linear cap after it, keeping hue', () => {
    const orange = oneModule('orange', 'colour-wash', { colours: '#ff8000', speed: 0 });
    const r = engineOn([orange], { gamma: 2.2, balance: [1, 0.9, 0.8] });
    r.engine.play('orange');
    r.run(1);
    const k = r.engine.scene.addr[0]!, o = r.engine.scene.order, at = () => [0, 1, 2].map((c) => r.last()[k + o[c]!]!);
    // 0x80/255 = 0.502: 0.502^2.2 × 0.9 × 255 = 50; blue 0 stays 0.
    assert.deepEqual(at(), [255, 50, 0]);
    r.engine.level(0.5);
    r.run(FADE.level + 0.05);
    assert.deepEqual(at(), [128, 25, 0]);   // half the light on each colour: the same orange
    r.engine.setLight(lightOf({ gamma: 1, balance: [1, 0.9, 0.8] }));   // saved again on the Light page: live
    r.run(0.05);
    assert.deepEqual(at(), [128, 58, 0]);   // 0.502 × 0.9 × ½ × 255
  });

  test('a strobe trips the flash guard: down to safe, held there until a look is picked', () => {
    const r = engineOn([strobe]);
    r.engine.play('strobe');
    r.run(4);
    const s = r.engine.state();
    assert.equal(s.look?.id, 'safe');
    assert.equal(s.tripped?.look, 'strobe');
    assert.ok(r.log.some((l) => /flash guard: strobe flashed/.test(l)));
    r.run(5);
    assert.equal(r.engine.state().look?.id, 'safe');
    r.engine.play('fire');
    assert.equal(r.engine.state().tripped, null);
    r.run(FADE.queue + 0.1);
    assert.equal(r.engine.state().look?.id, 'fire');
  });

  test('blackout and the master level fade the output; blackout off brings it back', () => {
    const r = engineOn();
    r.engine.play('heartbeat-plasma');
    r.run(1);
    assert.ok(r.lit() > 0);
    r.engine.blackout(true, 'cara');
    r.run(FADE.blackout + 0.05);
    assert.equal(r.lit(), 0);
    assert.equal(r.engine.state().blackout.on, true);
    assert.equal(r.engine.state().blackout.by, 'cara');
    r.engine.blackout(false);
    r.run(FADE.blackout + 0.05);
    const full = r.lit();
    r.engine.level(0.25);
    r.run(FADE.level + 0.05);
    assert.ok(r.lit() < full * 0.4, `${r.lit()} vs ${full}`);
    r.engine.fadeOut(0.5);
    r.run(0.55);
    assert.equal(r.lit(), 0);
  });

  test("a look that cannot play falls back to safe, saying why", () => {
    const r = engineOn();
    // Library code that does not compile (a bad pull): the look is resolved, but cannot play.
    const bad = oneModule('bad', 'clouds');
    bad.layers[0]!.modules![0]!.code = 'this is not js(';
    r.looks.set('bad', { look: bad, file: '' });
    r.engine.play('bad');
    r.run(0.1);
    assert.equal(r.engine.state().look?.id, 'safe');
    assert.ok(r.log.some((l) => /look bad cannot play/.test(l)));
  });

  test('controls and taps reach the playing look; skipped frames move its time on', () => {
    const r = engineOn();
    r.engine.play('beat-bars');
    r.run(0.1);
    assert.equal(r.engine.set('width', 0.9), true);
    r.run(0.2);
    assert.equal(r.engine.state().look!.controls.find((c) => c.name === 'width')!.value, 0.9);
    r.engine.tap(0);
    assert.equal(r.engine.tap(400), 150);
    const t = r.engine.state().look!.t;
    r.engine.skip(40);
    assert.ok(Math.abs(r.engine.state().look!.t - t - 1) < 1e-9);
    assert.equal(r.engine.stats.late, 40);
  });
});

describe('the frame timer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  test('ticks at the frame rate, and skips what it missed when behind', async () => {
    let clock = 0, ticks = 0, skipped = 0;
    const loop = runLoop({ tick: () => { ticks++; }, skip: (k) => { skipped += k; } }, 40, () => clock);
    clock = 1000;                    // a second lost (the machine stalled): 40 frames behind
    await vi.advanceTimersByTimeAsync(40);
    loop.stop();
    assert.equal(skipped, 38);       // frame 39 plays late, frame 40 on time
    assert.equal(ticks, 3);
  });

  test('keeps 40 fps on the timer clock', async () => {
    let ticks = 0;
    const loop = runLoop({ tick: () => { ticks++; }, skip: () => {} }, 40);
    await vi.advanceTimersByTimeAsync(500);
    loop.stop();
    assert.equal(ticks, 21);
    assert.equal(loop.fps(), 40);
  });

  test('renders nothing while idle, and picks up without skipping when it is not', async () => {
    let ticks = 0, skipped = 0, idle = true;
    const loop = runLoop({ tick: () => { ticks++; }, skip: (k) => { skipped += k; } }, 40, undefined, () => idle);
    await vi.advanceTimersByTimeAsync(400);
    assert.equal(ticks, 0);
    assert.equal(loop.fps(), 0);
    idle = false;
    await vi.advanceTimersByTimeAsync(500);
    loop.stop();
    assert.equal(ticks, 17);
    assert.equal(skipped, 0);
  });
});

test('the loop wraps at its duration and the beat carries on, a duration off the frame grid too', () => {
  const r = engineOn([oneModule('odd', 'clouds', {}, { duration: 1.013, bpm: 120 })]);
  r.engine.play('odd');
  r.run(0.3);
  r.engine.tap(0);
  const beatAt = () => r.engine.state().look!.beats;
  const b0 = beatAt();
  r.run(5);
  assert.ok(r.engine.state().look!.t < 1.013);
  assert.ok(Math.abs(beatAt() - b0 - 10) < 1e-9, `${beatAt() - b0}`);
});

test('a bpm push still easing on the frame the loop wraps keeps the beat going, never jumping', () => {
  const r = engineOn([oneModule('odd', 'clouds', {}, { duration: 1.013, bpm: 120, globals: { live: ['bpm'] } })]);
  r.engine.play('odd');
  r.run(0.3);
  r.engine.tap(0);
  r.run(0.675);                      // frame 39 of the look: the ease runs into the wrap at 1.013 s
  r.engine.set('bpm', 60);
  let before = r.engine.state().look!.beats;
  for (let i = 0; i < 8; i++) {
    r.engine.tick();
    const now = r.engine.state().look!.beats, step = now - before;
    assert.ok(step > 60 / 60 / 40 - 1e-9 && step < 120 / 60 / 40 + 1e-9, `frame ${i}: ${step} beats`);
    before = now;
  }
  assert.equal(r.engine.state().look!.bpm, 60);
});
