// Values a live engine sets in place on a prepared look (pi/src/controls.ts), for a viewer following one (SPEC-live
// "Following /pi"): set before a frame, so clocks bound to them run on unbroken, as on the engine.
import { GLOBALS, type PreparedLook } from './pattern-core.ts';

/** Globals and macros by name, the tempo and downbeat, and the look clock's offset. */
export type LiveSet = { values: Record<string, number>; bpm: number; beat0: number; offset: number };

export function setLive(L: PreparedLook, s: LiveSet) {
  for (const [name, v] of Object.entries(s.values)) {
    if (Object.hasOwn(GLOBALS, name)) L.g[name as keyof typeof GLOBALS] = v;
    else { const m = L.g.macros.find((x) => x.name === name); if (m) m.value = v; }
  }
  Object.assign(L, { bpm: s.bpm > 0 ? s.bpm : L.bpm, beat0: s.beat0, offset: s.offset });
}
