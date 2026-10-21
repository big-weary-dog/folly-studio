// The palette knob (SPEC-liveplay "The palette knob"): data/palettes.json's palettes by name, and a blend from the
// colours showing to a new palette over BLEND seconds, in OKLab, in one palette whose colours change in place (made
// once per change), so the frame loop allocates nothing and picks walk it as it moves (RUN.moved).
import PALETTES from '../../public/data/palettes.json' with { type: 'json' };
import { fadeInto } from '../../public/js/core/oklab.ts';
import {
  type PaletteColours, paletteColours, PALETTE_ROLES, ramp, RUN,
} from '../../public/js/core/stdlib.ts';

export const BLEND = 2;   // seconds
const hexes = new Map(PALETTES.palettes.map(({ theme: _, ...p }) => [p.name, p] as const));
const named = new Map([...hexes].map(([name, p]) => [name, paletteColours(p)!]));
/** The palettes the knob offers, by name, in palettes.json's order. */
export const PALETTE_NAMES: readonly string[] = [...named.keys()];
export const paletteNamed = (name: string) => named.get(name) ?? null;
/** A palette by name as a look holds it ('#rrggbb' lists), the same object each time. */
export const paletteHexNamed = (name: string) => hexes.get(name) ?? null;

type Mutable = Record<string, unknown> & { all: number[][] };
/** A blend toward `to` from `from` (what shows now): step(dt) moves it, returning `to` itself once there. */
export function paletteBlend(from: PaletteColours, to: PaletteColours) {
  const mixed: Mutable = { name: to.name, all: [] }, starts: number[][] = [], ends: (readonly number[])[] = [];
  for (const role of PALETTE_ROLES) {
    const target = to[role], n = target.length;
    const was = from[role].length ? from[role] : from.body.length ? from.body : from.all;
    const list = target.map(() => [0, 0, 0]);
    mixed[role] = list;
    mixed.all.push(...list);
    for (let i = 0; i < n; i++) {
      starts.push(ramp(was, n > 1 ? i / (n - 1) : 0));
      ends.push(target[i]!);
      list[i]!.splice(0, 3, ...starts[starts.length - 1]!);
    }
  }
  let k = 0;
  return {
    palette: mixed as unknown as PaletteColours,
    /** dt seconds on: the colours eased toward `to`; `to` when there (the blend is done). */
    step(dt: number): PaletteColours | null {
      k = Math.min(1, k + dt / BLEND);
      if (k >= 1) return to;
      const e = k * k * (3 - 2 * k);
      for (let i = 0; i < ends.length; i++) fadeInto(starts[i]!, ends[i]!, e, mixed.all[i]!);
      RUN.moved++;
      return null;
    },
  };
}
