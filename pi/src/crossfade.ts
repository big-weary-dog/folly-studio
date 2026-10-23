// Keep the outgoing render alive during a crossfade; an interrupted fade starts from its visible mixture.
import type { Scene } from '../../public/js/pattern-core.ts';
import { type Playing, renderPlaying } from './playing.ts';

const power = (v: number, gamma: number) => Math.min(1, Math.max(0, v)) ** gamma;

export function crossfade(scene: Scene) {
  const scratch = new Float32Array(scene.count * 3), held = new Float32Array(scratch.length);
  let from: Playing | null = null, frame = 0, frozen = false, gain = 1;
  const close = () => { from?.baked?.close?.(); from = null; };
  return {
    get active() { return !!from; },
    start(p: Playing | null, at: number, visible: Float32Array, overlap: boolean, level: number) {
      frozen = !!from;
      gain = frozen ? 1 : level;
      if (frozen) held.set(visible);
      close();
      if (overlap) { from = p; frame = at; } else p?.baked?.close?.();
    },
    mix(into: Float32Array, amount: number, gamma: number, dt: number) {
      if (!from) return;
      if (frozen) scratch.set(held);
      else {
        const count = Math.round(from.duration / dt);
        if (frame >= count) { frame -= count; from.live?.wrapped(count * dt); }
        try { renderPlaying(from, scene, frame++, dt, scratch); } catch { scratch.fill(0); }
      }
      // Blend LED light, then encode again for the one output transform and flash guard that follow.
      for (let i = 0; i < into.length; i++) {
        into[i] = (power(scratch[i]!, gamma) * gain * (1 - amount)
          + power(into[i]!, gamma) * amount) ** (1 / gamma);
      }
      if (amount === 1) close();
    },
    close,
  };
}
