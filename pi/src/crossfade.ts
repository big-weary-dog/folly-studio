// Keep the outgoing render alive during a crossfade; an interrupted fade starts from its visible mixture.
import type { Scene } from '../../public/js/pattern-core.ts';
import { type Playing, renderPlaying } from './playing.ts';

const STEPS = 1024;
const sample = (table: Float64Array, x: number) => {
  const at = x * STEPS, i = at | 0;
  return table[i] + (table[i + 1] - table[i]) * (at - i);
};

export function crossfade(scene: Scene) {
  const scratch = new Float32Array(scene.count * 3), held = new Float32Array(scratch.length);
  let from: Playing | null = null, frame = 0, frozen = false, gain = 1;
  let curve = NaN;
  const dec = new Float64Array(STEPS + 2), enc = new Float64Array(STEPS + 2);
  const close = () => { from?.baked?.close?.(); from = null; };
  return {
    get active() { return !!from; },
    start(p: Playing | null, at: number, visible: Float32Array, overlap: boolean, level: number, relayed: boolean) {
      gain = from ? 1 : level;
      frozen = !!from || relayed;
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
      if (curve !== gamma) {
        curve = gamma;
        for (let i = 0; i < dec.length; i++) {
          const x = Math.min(1, i / STEPS);
          dec[i] = x ** gamma; enc[i] = x ** (2 / gamma);
        }
      }
      for (let i = 0; i < into.length; i++) {
        const a = Math.min(1, Math.max(0, scratch[i])), b = Math.min(1, Math.max(0, into[i]));
        const light = sample(dec, a) * gain * (1 - amount) + sample(dec, b) * amount;
        into[i] = light < 1 / STEPS ** 2 ? light ** (1 / gamma) : sample(enc, Math.sqrt(light));
      }
      if (amount === 1) close();
    },
    close,
  };
}
