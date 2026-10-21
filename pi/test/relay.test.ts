// pi/src/relay.ts in the engine: relayed frames play in place of its own render, through the same flash guard and
// output transform (a relayed strobe trips the guard; the same rgb makes the same bytes); a late frame is held, then
// the engine dips to its own render and comes back after a second of steady frames; a switch starts on its own. An
// `over` lease (Studio's editor) plays rev 0 over any look, through a switch, and a strobe on it ends it.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { ledChannels, prepareLight } from '../../public/js/pattern-core.ts';
import { lightOf } from '../../public/js/core/light.ts';
import { createRelay, RELAY } from '../src/relay.ts';
import { engineOn, rig } from './fixture.ts';

const who = {};
/** A relay on the rig, on a clock the test moves a frame per tick. */
function relayed() {
  const clock = { t: 0 }, relay = createRelay({ count: rig.count, fps: 40, now: () => clock.t });
  const r = engineOn([], undefined, undefined, relay);
  const slot = () => r.engine.stats.frames + r.engine.stats.late;
  /** The frame for `index`, of `rev` (the engine's playing rev unless said), its rgb from `fill(i)` (0..65535). */
  const frame = (index: number, fill: (i: number) => number, rev = r.engine.state().look?.rev ?? 0) => {
    const b = new Uint8Array(relay.bytes), v = new DataView(b.buffer);
    v.setUint32(0, index, true);
    v.setUint32(4, rev, true);
    for (let i = 0; i < rig.count * 3; i++) v.setUint16(8 + i * 2, fill(i), true);
    return b;
  };
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { clock.t += 25; r.engine.tick(); } };
  return { ...r, relay, clock, slot, frame, tick };
}

describe('relay to the lights', () => {
  test('one holder; a frame of the wrong size, out of its window, or from anyone else is not played', () => {
    const x = relayed(), other = {};
    assert.equal(x.relay.start(who, 'cara'), '');
    assert.equal(x.relay.start(other, 'boss'), 'cara is relaying to the lights.');
    assert.match(x.relay.push(other, x.frame(0, () => 0)), /relay-start/);
    assert.match(x.relay.push(who, new Uint8Array(100)), /bytes/);
    x.relay.stop(other);
    assert.equal(x.relay.holds(who), true);
    x.relay.stop(who);
    x.engine.play('fire');
    x.tick(60);
    assert.equal(x.relay.start(other, 'boss'), '');
    assert.equal(x.relay.state()?.by, 'boss');
    // Far ahead, or already played: dropped quietly.
    assert.equal(x.relay.push(other, x.frame(x.slot() + RELAY.slots, () => 65535)), '');
    assert.equal(x.relay.push(other, x.frame(x.slot() - 1, () => 65535)), '');
    assert.equal(x.relay.state()!.ahead, 0);
  });

  test('for the same rgb, the relayed frame\'s bytes are the local path\'s', () => {
    const x = relayed();
    x.engine.play('fire');
    x.tick(60);
    x.relay.start(who, 'cara');
    const q = (i: number) => (i * 7919) % 65536;
    for (let k = 0; k < 8; k++) x.relay.push(who, x.frame(x.slot() + k, q));
    x.tick(8);
    assert.equal(x.relay.state()!.on, true);
    const scene = x.engine.scene, rgb = new Float32Array(scene.count * 3).map((_, i) => q(i) / 65535);
    const want = ledChannels(scene, rgb, prepareLight(scene, lightOf()), new Uint8Array(scene.frameChannels),
      x.engine.state().gain);
    assert.deepEqual(x.last(), want);
  });

  test('a relayed strobe trips the flash guard down to safe', () => {
    const x = relayed();
    x.engine.play('fire');
    x.tick(60);
    x.relay.start(who, 'cara');
    for (let k = 0; k < 120; k++) {
      const s = x.slot();
      x.relay.push(who, x.frame(s, () => (Math.floor(s / 2) % 2 ? 65535 : 0)));
      x.tick();
      if (x.engine.state().tripped) break;
    }
    assert.equal(x.engine.state().tripped?.look, 'fire');
    assert.ok(x.log.some((l) => /flash guard/.test(l)));
  });

  test('a late frame is held, then the engine dips to its own; a second of steady frames brings the relay back', () => {
    const x = relayed();
    x.engine.play('fire');
    x.tick(60);
    x.relay.start(who, 'cara');
    const send = (n: number) => {
      for (let k = 0; k < n; k++) { x.relay.push(who, x.frame(x.slot(), () => 30000)); x.tick(); }
    };
    send(10);
    assert.deepEqual([x.relay.state()!.on, x.relay.gain()], [true, 1]);
    const held = x.lit();
    x.tick(RELAY.hold);       // held: still the relay's frame
    assert.deepEqual([x.relay.state()!.on, x.lit()], [true, held]);
    x.tick(2);                // dipping
    assert.ok(x.relay.gain() < 1);
    x.tick(4);                // down, and its own render fading in
    assert.equal(x.relay.state()!.on, false);
    assert.equal(x.relay.state()!.misses, 10);
    send(39);
    assert.equal(x.relay.state()!.on, false);
    send(1);
    assert.equal(x.relay.state()!.on, true);
    // A second with no frame at all ends the lease, and says why.
    const ended: string[] = [];
    x.relay.onEnd((_, why) => ended.push(why));
    x.tick(41);
    assert.equal(x.relay.state(), null);
    assert.match(ended[0]!, /No frames for a second/);
  });

  test('a switch starts the new look on the engine\'s own render, then its relayed frames', () => {
    const x = relayed();
    x.engine.play('fire');
    x.tick(60);
    x.relay.start(who, 'cara');
    const rev = x.engine.state().look!.rev;
    for (let k = 0; k < 80; k++) x.relay.push(who, x.frame(x.slot() + k, () => 65535, rev));
    x.tick(2);
    assert.equal(x.relay.state()!.on, true);
    x.engine.play('beat-bars', 0.25);
    while (x.engine.state().look?.id !== 'beat-bars') x.tick();
    x.tick();
    assert.equal(x.relay.state()!.on, false);
    const next = x.engine.state().look!.rev;
    x.relay.push(who, x.frame(x.slot(), () => 1000, next));
    x.tick();
    assert.equal(x.relay.state()!.on, true);
  });

  test('an over lease plays over any look, through a switch; a strobe on it ends it', () => {
    const x = relayed();
    x.engine.play('fire');
    x.tick(60);
    const ended: string[] = [];
    x.relay.onEnd((_, why) => ended.push(why));
    assert.equal(x.relay.start(who, 'cara', true), '');
    const send = (n: number, fill: (s: number) => number) => {
      for (let k = 0; k < n; k++) { const s = x.slot(); x.relay.push(who, x.frame(s, () => fill(s), 0)); x.tick(); }
    };
    send(5, () => 30000);
    assert.deepEqual([x.relay.state()!.over, x.relay.state()!.on], [true, true]);
    x.engine.play('beat-bars', 0.25);
    for (let k = 0; k < 40 && x.engine.state().look?.id !== 'beat-bars'; k++) send(1, () => 30000);
    send(2, () => 30000);
    assert.equal(x.engine.state().look?.id, 'beat-bars');
    assert.equal(x.relay.state()!.on, true);
    send(5, () => 30000);
    assert.equal(x.relay.state()!.misses, 0);
    for (let k = 0; k < 120 && x.relay.state(); k++) send(1, (s) => (Math.floor(s / 2) % 2 ? 65535 : 0));
    assert.ok(x.engine.state().tripped);
    assert.equal(x.relay.state(), null);
    assert.match(ended[0]!, /flash guard tripped/);
  });
});
