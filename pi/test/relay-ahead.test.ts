// Relay end to end, without a browser: the sandbox worker's render-ahead (public/js/relay-ahead.ts), told the
// engine's state as the Live tab tells it, feeds a relaying engine; a twin engine renders the same look itself. Their
// LEDs match frame for frame (bar Uint16 rounding), across the look's wraps with a lane and the beat carried on; a
// push lands one buffer later (the frames ahead were rendered before it), then they match again. From the editor,
// the frames follow its playhead's anchor.
import assert from 'node:assert/strict';

import { afterEach, describe, test, vi } from 'vitest';

import { compileLayer, prepareLayer, prepareLook, prepareScene } from '../../public/js/pattern-core.ts';
import { relayAhead, type RelayCfg } from '../../public/js/relay-ahead.ts';
import { piExtra, piLayers } from '../../public/js/ui/live/follow-pi.ts';
import { relaySet } from '../../public/js/ui/live/relay.ts';
import { clockNow } from '../../public/js/ui/relay-studio.ts';
import { createRelay } from '../src/relay.ts';
import { engineOn, lib, oneModule, rig } from './fixture.ts';

afterEach(() => { vi.useRealTimers(); });
// Bars on the beat, their pace and width macros (one with a lane), wrapping every 1.3 s.
const beat = oneModule('beat', 'bars', { bars: 5, speed: { mod: 'global', name: 'pace', from: 0, to: 2 },
  duty: { mod: 'global', name: 'width', from: 0.2, to: 1 } }, { duration: 1.3, bpm: 128, globals: { macros: {
    pace: { value: 0.3, min: 0, max: 1 }, width: { value: 0.5, min: 0, max: 1 } } },
  automation: { width: [[0, 0], [1.2, 1]] } });

describe('relay end to end', () => {
  test('the relayed engine\'s LEDs are its twin\'s, through wraps and a push', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const clock = { t: 0 }, relay = createRelay({ count: rig.count, fps: 40, now: () => clock.t });
    const a = engineOn([beat]), b = engineOn([beat], undefined, undefined, relay), who = {};
    for (const x of [a, b]) { x.engine.play('beat'); x.run(1.5); }
    relay.start(who, 'cara');

    // The worker, on the look the engine plays.
    const scene = prepareScene(rig), source = b.engine.source()!;
    const layers = piLayers(source, [...lib.entries.values()]).map((l) => prepareLayer(scene, l, compileLayer(l)));
    const live = prepareLook(piExtra(source));
    const ahead = relayAhead(() => ({ scene, layers, live }), (m) => {
      assert.equal(relay.push(who, new Uint8Array((m as { bytes: ArrayBuffer }).bytes)), '');
    });
    let off = 0, bytes = 0, worst = 0;
    const late: number[] = [];      // frames off by more than rounding: the push's glide, a buffer late
    for (let i = 0; i < 160; i++) {
      if (i === 60) { assert.ok(a.engine.set('pace', 0.9) && b.engine.set('pace', 0.9)); }
      const s = b.engine.state(), slot = b.engine.stats.frames + b.engine.stats.late;
      const cfg: Partial<RelayCfg> = { on: true, rev: s.look!.rev, next: slot, frame: Math.round(s.look!.t * 40),
        index: slot - 1, at: performance.timeOrigin + performance.now(), fps: 40, duration: s.look!.duration,
        lead: 4, set: relaySet(s.look!) };
      ahead.relay(cfg);
      vi.advanceTimersByTime(10);
      clock.t += 25;
      a.engine.tick();
      b.engine.tick();
      assert.equal(relay.state()!.on, true, `slot ${slot}`);
      const x = a.last(), y = b.last();
      let most = 0;
      for (let k = 0; k < x.length; k++) {
        const d = Math.abs(x[k]! - y[k]!);
        most = Math.max(most, d);
        if (d === 1) off++;
      }
      if (most > 1) late.push(i); else worst = Math.max(worst, most);
      bytes += x.length;
    }
    ahead.relay({ on: false });
    assert.ok(worst <= 1, `worst ${worst}`);
    assert.ok(off / bytes < 0.005, `${off} of ${bytes} bytes off by one`);
    assert.equal(relay.state()!.misses, 0);
    assert.ok(late.length && late.every((i) => i >= 60 && i < 100), `late ${late}`);
  });
});

describe('relay from the editor', () => {
  test('frames follow the playhead\'s anchor, wrapped; a pause renders again from the next slot', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const scene = prepareScene(rig), { engine, run } = engineOn([beat]);
    engine.play('beat');
    run(0.1);
    // The show time, as red: 0..10 s.
    const [l] = piLayers(engine.source()!, [...lib.entries.values()]).map((x) => ({ ...x, modules: x.modules
      .map((m) => ({ ...m, code: 'function pixel(p, t) { return [t / 10, 0, 0]; }' })) }));
    const layers = [prepareLayer(scene, l!, compileLayer(l!))], got: { slot: number, t: number }[] = [];
    const ahead = relayAhead(() => ({ scene, layers, live: null }), (m) => {
      const bytes = (m as { bytes: ArrayBuffer }).bytes, head = new DataView(bytes, 0, 8);
      got.push({ slot: head.getUint32(0, true), t: new Uint16Array(bytes, 8)[0]! / 65535 * 10 });
    });
    const at = performance.timeOrigin + performance.now();
    const cfg = { on: true, rev: 0, index: 100, at, fps: 40, lead: 8, set: null };
    ahead.relay({ ...cfg, clock: { t: 2, at, speed: 2, playing: true, duration: 2.1 } });
    vi.advanceTimersByTime(30);
    assert.deepEqual(got.map((g) => g.slot), [101, 102, 103, 104, 105, 106, 107, 108]);
    for (const g of got) {
      const t = (2 + (g.slot - 100) / 40 * 2) % 2.1;
      assert.ok(Math.abs(g.t - t) < 0.002, `slot ${g.slot}: ${g.t} not ${t}`);
    }
    assert.ok(got.some((g) => g.t < 0.5), 'wrapped');
    got.length = 0;
    // Paused at 5 s: the frames ahead again, all at 5 s, from the slot after the one playing.
    ahead.relay({ ...cfg, clock: { t: 5, at, speed: 2, playing: false, duration: 2.1 } });
    vi.advanceTimersByTime(30);
    assert.equal(got[0]!.slot, 101);
    assert.ok(got.every((g) => Math.abs(g.t - 5) < 0.001));
    // The same anchor again (each state says it): nothing rendered again.
    const n = got.length;
    ahead.relay({ ...cfg, clock: { t: 5, at, speed: 2, playing: false, duration: 2.1 } });
    vi.advanceTimersByTime(30);
    assert.equal(got.length, n);
    ahead.relay({ on: false });
  });

  test('the anchor\'s time at a moment', () => {
    const k = { t: 1, at: 1000, speed: 0.5, playing: true, duration: 4 };
    assert.equal(clockNow(k, 3000), 2);
    assert.equal(clockNow(k, 9000), 1);
    assert.equal(clockNow({ ...k, playing: false }, 9000), 1);
  });
});
