// Relay end to end, without a browser: the sandbox worker's render-ahead (public/js/relay-ahead.ts), told the
// engine's state as the Live tab tells it, feeds a relaying engine; a twin engine renders the same look itself. Their
// LEDs match frame for frame (bar Uint16 rounding), across the look's wraps with a lane and the beat carried on; a
// push lands one buffer later (the frames ahead were rendered before it), then they match again.
import assert from 'node:assert/strict';

import { afterEach, describe, test, vi } from 'vitest';

import { compileLayer, prepareLayer, prepareLook, prepareScene } from '../../public/js/pattern-core.ts';
import { relayAhead, type RelayCfg } from '../../public/js/relay-ahead.ts';
import { piExtra, piLayers } from '../../public/js/ui/live/follow-pi.ts';
import { relaySet } from '../../public/js/ui/live/relay.ts';
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
