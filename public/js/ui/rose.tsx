// The rose window as SVG: sixteen lancet petals in the real window's seven rings round a hub. The brand mark, the
// loader and an idea's progress; colour and motion live in CSS (.rose in base.css, pages.css).
import { useMemo } from 'preact/hooks';

const PETALS = 16;
const R = 98;                         // the petal tips, in a 200-unit viewBox
// Radii as fractions of the window: the hub, the rings, the shoulder where a petal closes into its point, the tip.
const HUB = 0.184, SHOULDER = 0.73, TIP = 0.99;
const RINGS = [HUB, 0.275, 0.395, 0.512, 0.637, 0.738, 0.832, TIP];
// Cells across each ring and their glass: amber, ruby, cobalt, emerald, violet.
const CELLS = [['a'], ['c', 'c'], ['r'], ['c', 'c'], ['v', 'a', 'v'], ['r', 'r'], ['c', 'e', 'c']];
const SPLITS: Record<number, number[]> = { 1: [0, 1], 2: [0, 0.5, 1], 3: [0, 0.27, 0.73, 1] };
const BANDS: [number, number, string][] = [[0, 3, 'c'], [3, 7, 'r']];  // the small mark: two bands, no mullions
const WIDE = 0.1745;                  // a petal's widest half-angle (10° of the 11.25° it has)
const T0 = SHOULDER * WIDE, L = TIP - SHOULDER, RHO = (L * L + T0 * T0) / (2 * T0);

/** A petal's half-angle at radius r: open fast from the hub, close in a pointed arch. */
function halfAngle(r: number) {
  if (r <= HUB) return 0;
  if (r < SHOULDER) return WIDE * (1 - (1 - Math.min(1, (r - HUB) / 0.3)) ** 3);
  const s = Math.min(L, r - SHOULDER);
  return Math.max(0, Math.sqrt(RHO * RHO - s * s) - (RHO - T0)) / r;
}

const pt = (r: number, a: number) => `${(R * r * Math.sin(a)).toFixed(1)} ${(-R * r * Math.cos(a)).toFixed(1)}`;

/** One cell: radii r0..r1, across-the-petal fractions f0..f1, round angle `mid`. */
function cell(mid: number, r0: number, r1: number, f0: number, f1: number) {
  const n = r1 > SHOULDER ? 8 : 3;
  const side = (f: number, from: number, to: number) => Array.from({ length: n + 1 }, (_, k) => {
    const r = from + ((to - from) * k) / n;
    return pt(r, mid + (2 * f - 1) * halfAngle(r));
  });
  return `M${side(f0, r0, r1).join('L')}L${side(f1, r1, r0).join('L')}Z`;
}

/** Each petal's cells as [glass, path], drawn once per detail. */
const petals = new Map<boolean, [string, string][][]>();
function petalsOf(full: boolean) {
  let out = petals.get(full);
  if (out) return out;
  out = Array.from({ length: PETALS }, (_, i) => {
    const mid = (i * 2 * Math.PI) / PETALS;
    return full ? CELLS.flatMap((glass, ring) => glass.map((k, j): [string, string] => {
      const f = SPLITS[glass.length];
      return [k, cell(mid, RINGS[ring], RINGS[ring + 1], f[j], f[j + 1])];
    })) : BANDS.map(([a, b, k]): [string, string] => [k, cell(mid, RINGS[a], RINGS[b], 0, 1)]);
  });
  petals.set(full, out);
  return out;
}

/** detail: full | mark (two bands); label: its alt text (else decorative). */
export function Rose({ detail = 'mark', class: cls = '', label = '' }: { detail?: 'full' | 'mark'; class?: string;
  label?: string }) {
  // Animations run on the page's clock, so a rose drawn later keeps the same phase as the others.
  const t0 = useMemo(() => -Math.round(performance.now()), []);
  return (
    <svg class={`rose rose-${detail} ${cls}`.trim()} viewBox="-100 -100 200 200" focusable="false"
      style={`--t0:${t0}ms`} role={label ? 'img' : undefined} aria-label={label || undefined}
      aria-hidden={label ? undefined : 'true'}>
      <circle class="rose-stone" r={100} />
      {petalsOf(detail === 'full').map((cells, i) => (
        <g class="rp" style={`--i:${i}`}>{cells.map(([k, d]) => <path class={`g-${k}`} d={d} />)}</g>))}
      <circle class="rose-hub g-a" r={(R * HUB * 0.86).toFixed(1)} />
      <circle class="rose-boss" r={(R * HUB * 0.34).toFixed(1)} />
    </svg>);
}
