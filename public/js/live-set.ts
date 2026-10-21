// Values a live engine sets in place on a prepared look (pi/src/controls.ts), for a viewer following one (SPEC-live
// "Following /pi"): set before a frame, so clocks bound to them run on unbroken, as on the engine.
import type { PreparedLook } from './pattern-core.ts';

/** Macros by name, the tempo and downbeat, the look clock's offset and its paces' (SPEC "Globals"). */
export type LiveSet = { values: Record<string, number>; bpm: number; beat0: number; offset: number;
  paces?: Record<string, number> };

export function setLive(L: PreparedLook, s: LiveSet) {
  for (const [name, v] of Object.entries(s.values)) {
    const m = L.g.macros.find((x) => x.name === name);
    if (m) m.value = v;
  }
  Object.assign(L, { bpm: s.bpm > 0 ? s.bpm : L.bpm, beat0: s.beat0, offset: s.offset });
  L.paceOffset.clear();
  for (const [name, v] of Object.entries(s.paces ?? {})) L.paceOffset.set(name, v);
}

const fin = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** An object's finite numbers. */
const numbers = (o: unknown) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {})
  .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Record<string, number>;
/** A frame's values to set in place, as a message gave them: numbers only. */
export const liveSetOf = (s: LiveSet | undefined): LiveSet | null => (s && typeof s === 'object' ? { bpm: fin(s.bpm),
  beat0: fin(s.beat0), offset: fin(s.offset), values: numbers(s.values), paces: numbers(s.paces) } : null);
