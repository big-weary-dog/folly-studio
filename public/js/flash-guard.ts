// flash-guard.ts: watches the frames the Studio shows for large-area flashing by the rule bakes are checked with (the
// core's FlashWatch, with the server's limits), so the preview can dim a strobe as soon as it starts. Pure; nothing
// allocated per frame. test/flash-guard.test.js holds it to src/frames.ts's verdicts.

import type { Rig } from '../../shared/schemas/rig.ts';
import { type FlashLimits, FlashWatch } from './core/flash.ts';
import { prepareScene } from './core/scene.ts';

const HOLD_MS = 2500;        // stays on this long after the last flashing second, so it does not blink

/**
 * new FlashGuard(rig, limits?); guard.observe(rgb, ms) → true while a large area flashes more than `perSecond` times
 * a second (and for a moment after). rgb: Float32Array(count × 3), 0..1, as shown.
 */
export class FlashGuard {
  watch: FlashWatch; count: number; until = -Infinity; lum: Float32Array;

  constructor(rig: Rig, limits?: Partial<FlashLimits> | null) {
    this.watch = new FlashWatch(prepareScene(rig), limits);
    this.count = rig.count | 0;
    this.lum = new Float32Array(this.count);
  }

  reset() {
    this.watch.reset();
    this.until = -Infinity;
  }

  observe(rgb: Float32Array, now: number) {
    const lum = this.lum;
    for (let k = 0; k < this.count; k++) {
      const r = rgb[3 * k], g = rgb[3 * k + 1], b = rgb[3 * k + 2];
      lum[k] = 0.2126 * (r < 0 ? 0 : r > 1 ? 1 : r) + 0.7152 * (g < 0 ? 0 : g > 1 ? 1 : g)
        + 0.0722 * (b < 0 ? 0 : b > 1 ? 1 : b);
    }
    if (this.watch.frame(lum, now)) this.until = now + HOLD_MS;
    return now < this.until;
  }
}
