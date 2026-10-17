// The Folly's rose window as inline SVG: sixteen lancet petals leaded into the real window's seven rings
// (cathedral.json rows 1–7), round a hub. The brand mark, the loader (petals light in turn) and an idea's
// progress (petals fill); colour and motion live in CSS (.rose in base.css, ideas.css).
import { svg } from './dom.js';

const PETALS = 16;
const R = 98;                         // the petal tips, in a 200-unit viewBox
// Radii as fractions of the window (2.44 m): the hub's edge, the ring boundaries, the shoulder
// where a petal starts to close into its point, and the tip.
const HUB = 0.184, SHOULDER = 0.73, TIP = 0.99;
const RINGS = [HUB, 0.275, 0.395, 0.512, 0.637, 0.738, 0.832, TIP];
// Cells across each ring (1, 2 or 3, as in the real window) and their glass: a = amber,
// r = ruby, c = cobalt, e = emerald, v = violet.
const CELLS = [['a'], ['c', 'c'], ['r'], ['c', 'c'], ['v', 'a', 'v'], ['r', 'r'], ['c', 'e', 'c']];
const SPLITS = { 1: [0, 1], 2: [0, 0.5, 1], 3: [0, 0.27, 0.73, 1] };
const BANDS = [[0, 3, 'c'], [3, 7, 'r']];  // the small mark: two bands, no mullions
const WIDE = 0.1745;                  // a petal's widest half-angle (10° of the 11.25° it has)
const T0 = SHOULDER * WIDE, L = TIP - SHOULDER, RHO = (L * L + T0 * T0) / (2 * T0);

/** A petal's half-angle at radius r: it opens fast from the hub, then closes in a pointed arch. */
function halfAngle(r) {
  if (r <= HUB) return 0;
  if (r < SHOULDER) return WIDE * (1 - (1 - Math.min(1, (r - HUB) / 0.3)) ** 3);
  const s = Math.min(L, r - SHOULDER);
  return Math.max(0, Math.sqrt(RHO * RHO - s * s) - (RHO - T0)) / r;
}

const pt = (r, a) => `${(R * r * Math.sin(a)).toFixed(1)} ${(-R * r * Math.cos(a)).toFixed(1)}`;

/** One cell: between radii r0..r1 and across-the-petal fractions f0..f1, round angle `mid`. */
function cell(mid, r0, r1, f0, f1) {
  const n = r1 > SHOULDER ? 8 : 3;
  const side = (f, from, to) => Array.from({ length: n + 1 }, (_, k) => {
    const r = from + ((to - from) * k) / n;
    return pt(r, mid + (2 * f - 1) * halfAngle(r));
  });
  return `M${side(f0, r0, r1).join('L')}L${side(f1, r1, r0).join('L')}Z`;
}

/** rose({ detail: full (14 cells a petal) | mark (two bands, small sizes), className, label (else decorative) }) */
export function rose({ detail = 'mark', className = '', label = '' } = {}) {
  const full = detail === 'full';
  const kids = [svg('circle', { class: 'rose-stone', r: 100 })];
  for (let i = 0; i < PETALS; i++) {
    const mid = (i * 2 * Math.PI) / PETALS;
    const petal = svg('g', { class: 'rp', style: `--i:${i}` });
    if (full) {
      CELLS.forEach((glass, ring) => glass.forEach((k, j) => {
        const f = SPLITS[glass.length];
        petal.append(svg('path', { class: `g-${k}`,
          d: cell(mid, RINGS[ring], RINGS[ring + 1], f[j], f[j + 1]) }));
      }));
    } else {
      for (const [a, b, k] of BANDS) {
        petal.append(svg('path', { class: `g-${k}`, d: cell(mid, RINGS[a], RINGS[b], 0, 1) }));
      }
    }
    kids.push(petal);
  }
  kids.push(svg('circle', { class: 'rose-hub g-a', r: (R * HUB * 0.86).toFixed(1) }),
    svg('circle', { class: 'rose-boss', r: (R * HUB * 0.34).toFixed(1) }));
  // Animations run on the page's clock, so a rose drawn again (a list re-rendered) keeps its phase.
  const attrs = { class: `rose rose-${detail} ${className}`.trim(), viewBox: '-100 -100 200 200',
    focusable: 'false', style: `--t0:${-Math.round(performance.now())}ms` };
  if (label) Object.assign(attrs, { role: 'img', 'aria-label': label });
  else attrs['aria-hidden'] = 'true';
  return svg('svg', attrs, ...kids);
}
