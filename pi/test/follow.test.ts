// What the engine publishes for Studio's Live tab (SPEC-live "Following /pi"): its source, values and clock, set in
// place each frame, are enough for a viewer's core to render every frame the engine sent, byte for byte, through
// pushes (to macros bound to clocks too) and a tap; the source's rev moves at a switch and when a push leaves a lane,
// and the control page gets the source on hello.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';
import WebSocket from 'ws';

import {
  compileLayer, LIGHT, ledChannels, prepareLayer, prepareLight, prepareLook, prepareScene, renderFrame,
} from '../../public/js/pattern-core.ts';
import { setLive } from '../../public/js/live-set.ts';
import { piExtra, piLayers, piSet } from '../../public/js/ui/live/follow-pi.ts';
import { piNowOf } from '../../src/live/pi-feed.ts';
import type { PiState } from '../src/protocol.ts';
import { controlServer } from '../src/server.ts';
import { engineOn, lib, oneModule, rig } from './fixture.ts';

const speedy = oneModule('speedy', 'bars', { bars: 5, speed: { mod: 'global', name: 'pace', from: 0, to: 2 },
  duty: { mod: 'global', name: 'width', from: 0.2, to: 1 } }, { globals: { macros: {
    pace: { value: 0.3, min: 0, max: 1 }, width: { value: 0.5, min: 0, max: 1 } } },
  automation: { width: [[0, 0], [20, 1]] } });
const scene = prepareScene(rig);

/** A Live viewer on the engine's source: each frame, the values the engine published set in place, then that frame
 * rendered; frame() → its channels, to hold to what the engine sent. */
function viewer(r: ReturnType<typeof engineOn>) {
  const source = r.engine.source()!, rgb = new Float32Array(scene.count * 3), out = new Uint8Array(scene.frameChannels);
  const layers = piLayers(source, [...lib.entries.values()]).map((l) => prepareLayer(scene, l, compileLayer(l)));
  const L = prepareLook(piExtra(source)), light = prepareLight(scene, LIGHT);
  return {
    rev: source.rev,
    frame() {
      const now = piNowOf(r.engine.state() as unknown as PiState)!;
      setLive(L, piSet(now));
      renderFrame(scene, layers, now.t - 1 / r.engine.fps, rgb, L);
      return ledChannels(scene, rgb, light, out);
    },
  };
}
/** Plays `secs` with the viewer beside: how many frames differed. */
function beside(r: ReturnType<typeof engineOn>, v: ReturnType<typeof viewer>, secs: number) {
  let off = 0;
  for (let i = 0; i < Math.round(secs * r.engine.fps); i++) {
    r.engine.tick();
    const a = v.frame(), b = r.last();
    if (a.some((x, j) => x !== b[j])) off++;
  }
  return off;
}

describe('following the engine', () => {
  test('a viewer renders every frame the engine sends: macros bound to clocks and a tap', () => {
    const r = engineOn();
    r.engine.play('heartbeat-plasma');
    r.run(1);
    const v = viewer(r);
    assert.equal(beside(r, v, 0.5), 0);
    r.engine.set('drive', 0.9);
    r.engine.tap(1000);
    assert.equal(beside(r, v, 0.3), 0);
    r.engine.tap(1400);
    r.engine.set('ripple', 0.8);
    assert.equal(beside(r, v, 1.2), 0);
    assert.equal(r.engine.state().gain, 1);
    assert.ok(r.lit() > 0);
  });

  test('and after a push that leaves a lane, which is a new source', () => {
    const r = engineOn([speedy]);
    r.engine.play('speedy');
    r.run(2);
    let v = viewer(r);
    assert.equal(beside(r, v, 0.5), 0);
    r.engine.set('pace', 0.85);
    assert.equal(beside(r, v, 1), 0);
    r.engine.set('width', 0.2);
    assert.ok(r.engine.source()!.rev > v.rev, 'the width left its lane');
    assert.equal(r.engine.source()!.automation?.width, undefined);
    v = viewer(r);
    assert.equal(beside(r, v, 1), 0);
    r.engine.set('pace', 0.6);
    assert.equal(r.engine.source()!.rev, v.rev, 'a push on no lane keeps the source');
    assert.equal(beside(r, v, 1), 0);
  });

  test('the source names modules by ref, without code; a switch moves its rev', () => {
    const r = engineOn();
    r.engine.play('fire');
    r.run(1);
    const a = r.engine.source()!;
    assert.equal(a.id, 'fire');
    for (const l of a.layers) for (const m of 'modules' in l ? l.modules : []) assert.equal('code' in m, false);
    r.engine.play('beat-bars');
    r.run(1);
    assert.ok(r.engine.source()!.rev > a.rev);
  });

  test('the control page gets the source on hello and at a switch', async () => {
    const r = engineOn();
    r.engine.play('fire');
    r.run(0.2);
    const state = () => ({ ...r.engine.state(), looks: [], out: {} } as unknown as PiState);
    const s = await controlServer({ engine: r.engine, state, pin: '', port: 0, host: '127.0.0.1' });
    const origin = `http://127.0.0.1:${s.port}`, ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, { origin });
    const got: { type: string, source?: { id: string } }[] = [];
    ws.on('message', (d) => got.push(JSON.parse(String(d))));
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello' })));
    const until = async (ok: () => boolean) => {
      for (let i = 0; i < 100 && !ok(); i++) await new Promise((res) => setTimeout(res, 10));
      assert.ok(ok());
    };
    await until(() => got.some((m) => m.type === 'source'));
    assert.equal(got.find((m) => m.type === 'source')!.source!.id, 'fire');
    r.engine.play('beat-bars');
    r.run(1);
    await until(() => got.some((m) => m.source?.id === 'beat-bars'));
    ws.close();
    await s.close();
  });
});
