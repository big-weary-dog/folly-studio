// Live crossfades retain the output gamma and outgoing gain, including when gamma changes during a fade.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { prepareScene } from '../../public/js/pattern-core.ts';
import { crossfade } from '../src/crossfade.ts';
import type { Playing } from '../src/playing.ts';
import { rig } from './fixture.ts';

test('tabled crossfade light stays within one output byte of the power curve across gamma changes', () => {
  const scene = prepareScene(rig), fade = crossfade(scene);
  const outgoing = Float32Array.from({ length: scene.count * 3 }, (_, i) => (i % 257) / 256);
  const incoming = Float32Array.from(outgoing, (_, i) => ((i * 41) % 263) / 262);
  const rgb = incoming.slice(), gain = 0.37;
  const p = { duration: 30, live: null,
    baked: { fill: (_: number, out: Float32Array) => out.set(outgoing) } } as Playing;
  fade.start(p, 0, outgoing, true, gain, true);
  for (const gamma of [1, 2.2, 3, 1.7]) {
    for (const amount of [0, 0.025, 0.4, 0.975]) {
      rgb.set(incoming);
      fade.mix(rgb, amount, gamma, 1 / scene.fps);
      for (let i = 0; i < rgb.length; i++) {
        const expected = outgoing[i]! ** gamma * gain * (1 - amount) + incoming[i]! ** gamma * amount;
        assert.ok(Math.abs(Math.round(rgb[i]! ** gamma * 255) - Math.round(expected * 255)) <= 1);
      }
    }
  }
  fade.close();
});
