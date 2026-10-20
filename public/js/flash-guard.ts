// flash-guard.ts: watches the frames the Studio shows for large-area flashing by the rule bakes are checked with (the
// core's FlashWatch, with the server's limits, on the light the LEDs would give), so the preview can dim a strobe as
// soon as it starts. Pure; nothing allocated per frame. test/flash-guard.test.js holds it to src/frames.ts's verdicts.

import type { Rig } from '../../shared/schemas/rig.ts';
import { type FlashLimits, FlashWatch } from './core/flash.ts';
import { type Light, ledLight } from './core/light.ts';
import { prepareScene } from './core/scene.ts';

const HOLD_MS = 2500;        // stays on this long after the last flashing second, so it does not blink

/**
 * new FlashGuard(rig, limits?, light?); guard.observe(rgb, ms, cap = 1) → true while a large area flashes more than
 * `perSecond` times a second (and for a moment after). rgb: Float32Array(count × 3), 0..1 encoded, as shown; each
 * channel is taken to its output byte and the light that byte gives (`light`, the light settings, LIGHT by default),
 * as a bake is checked, × `cap` (the Pi's master: linear light).
 */
export class FlashGuard {
  watch: FlashWatch; count: number; until = -Infinity; lum: Float32Array; light: Float32Array;

  constructor(rig: Rig, limits?: Partial<FlashLimits> | null, light?: Light) {
    this.watch = new FlashWatch(prepareScene(rig), limits);
    this.light = ledLight(light);
    this.count = rig.count | 0;
    this.lum = new Float32Array(this.count);
  }

  reset() {
    this.watch.reset();
    this.until = -Infinity;
  }

  observe(rgb: Float32Array, now: number, cap = 1) {
    const lum = this.lum, L = this.light;
    for (let k = 0; k < this.count; k++) {
      lum[k] = cap * Math.max(L[byte(rgb[3 * k])], L[256 + byte(rgb[3 * k + 1])], L[512 + byte(rgb[3 * k + 2])]);
    }
    if (this.watch.frame(lum, now)) this.until = now + HOLD_MS;
    return now < this.until;
  }
}

/** A value's output byte (toChannels' rounding, clamped). */
const byte = (v: number) => (v > 0 ? (v < 1 ? Math.round(v * 255) : 255) : 0);
