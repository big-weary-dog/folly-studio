// Integrated clocks (SPEC "Integrated clocks"): clock(name) is ∫ P[name] dT from the start, how far a speed param has
// moved things in pattern time, so modulating a speed never makes the motion jump. A fixed value is that value × T. A
// bound one is summed over show time on a fixed grid from 0 (the trapezoid rule), so a frame reached by playing and
// the same frame sought to read the same clock, to the bit.
import { type Mod, modValue, type Values } from './globals.ts';
import { RUN } from './stdlib.ts';
import { layerEnvelope } from './timeline.ts';
import type { Clip } from '../../../shared/schemas/look.ts';

const CLOCK_STEP = 1 / 128;      // seconds: a power of two, so every grid time is exact

/** A bound clock's sum: to grid step n (its integrand f there), for one look; its value and rate at show time `at`. */
type Sum = { n: number, sum: number, f: number, at: number, value: number, rate: number, look: unknown };

/** A module instance's clocks: bound to its values, bindings and clips when its layer is prepared. */
export function newClocks() {
  let P: Values = {}, bound = new Map<string, Mod>(), clips: readonly Clip[] | null = null;
  const sums = new Map<string, Sum>();
  /** What a bound param moves things by at show time t: its value then. */
  const rate = (m: Mod, t: number) => {
    const L = RUN.look!, g = m.kind === 1 ? L.normAt(m.name, t) : 0;
    const env = m.kind === 2 && clips ? layerEnvelope(clips, t) : 1;
    return modValue(m, t, g, env, L);
  };
  /** s brought to show time t: the sum to its last grid step, then the part step to t. */
  const sum = (m: Mod, s: Sum | undefined, name: string, t: number, L: unknown) => {
    if (!s || s.look !== L) sums.set(name, s = { n: 0, sum: 0, f: rate(m, 0), at: NaN, value: 0, rate: 0, look: L });
    s.at = t;
    s.rate = rate(m, t > 0 ? t : 0);
    if (!(t > 0)) { s.value = 0; return s; }
    const N = Math.floor(t / CLOCK_STEP);
    if (N < s.n) { s.n = 0; s.sum = 0; s.f = rate(m, 0); }       // back in time: from the start again
    while (s.n < N) {
      const f = rate(m, (s.n + 1) * CLOCK_STEP);
      s.sum += (s.f + f) * (CLOCK_STEP / 2);
      s.f = f; s.n++;
    }
    s.value = s.sum + (s.f + s.rate) * ((t - s.n * CLOCK_STEP) / 2);
    return s;
  };
  return {
    bind(values: Values, mods: readonly Mod[], layerClips: readonly Clip[] | null) {
      P = values; clips = layerClips; sums.clear();
      bound = new Map(mods.filter((m) => !m.into).map((m) => [m.key, m]));
    },
    /** clock(name): ∫ P[name] dT, the distance number param `name` (a speed) has moved things by now; in an
     * instance (RUN.dt), by its own time: shifted by dt at the param's rate now. */
    clock(name: string): number {
      const L = RUN.look, t = RUN.t, m = L ? bound.get(name) : undefined;
      if (!m) { const v = P[name]; return typeof v === 'number' ? v * (RUN.T + RUN.dt) : 0; }
      let s = sums.get(name);
      if (!s || s.at !== t || s.look !== L) s = sum(m, s, name, t, L);
      return RUN.dt ? s.value + RUN.dt * s.rate : s.value;
    },
  };
}
export type Clocks = ReturnType<typeof newClocks>;
