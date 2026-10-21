// Where a step's card and shade go. The preview is what most steps change, so the shade leaves it clear and the card
// sits off it wherever it fits.
import type { Box } from './anchors.ts';

export const PAD = 6, GAP = 12, W = 316;   // W: .tour-step's width, which fits beside the preview in the side panel

const overlap = (a: Box, b: Box | null) => (b ? Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) : 0);
/** The ring round a control's box. */
const grow = (b: Box) => ({ x: b.x - PAD, y: b.y - PAD, w: b.w + 2 * PAD, h: b.h + 2 * PAD });

/** The card's place: beside the ring (below, above, right, left, or beside it just under the preview), else a
 * corner of the window; the first that keeps off the preview, the ring and what it sits in (`area`), else the one
 * covering least of them (the ring counting most). */
export function place(ring: Box | null, h: number, preview: Box | null, area: Box | null = null) {
  const vw = innerWidth, vh = innerHeight;
  const cx = (v: number) => Math.max(GAP, Math.min(vw - W - GAP, v)), cy = (v: number) => Math.max(GAP,
    Math.min(vh - h - GAP, v));
  const spots: [number, number][] = [], r = ring && grow(ring);
  if (r) {
    spots.push([cx(r.x), r.y + r.h + GAP], [cx(r.x), r.y - GAP - h], [r.x + r.w + GAP, cy(r.y)],
      [r.x - GAP - W, cy(r.y)]);
    const under = preview && preview.y + preview.h + GAP;
    if (under) spots.push([r.x - GAP - W, under], [r.x + r.w + GAP, under]);
  }
  spots.push([GAP, vh - h - GAP], [vw - W - GAP, vh - h - GAP], [GAP, GAP + 48], [vw - W - GAP, GAP + 48]);
  let best: Box | null = null, least = Infinity;
  for (const [x, y] of spots) {
    const b = { x, y, w: W, h };
    if (x < GAP - 0.5 || y < GAP - 0.5 || x + W > vw - GAP + 0.5 || y + h > vh - GAP + 0.5) continue;
    const cover = overlap(b, preview) + 10 * overlap(b, r) + overlap(b, area && grow(area));
    if (cover < least) { best = b; least = cover; }
    if (cover === 0) break;
  }
  const at = best ?? { x: cx((vw - W) / 2), y: vh - h - 48 };
  return { left: `${at.x}px`, top: `${at.y}px` };
}

/** The shade's clip: the whole window but the preview and the ring (with what it sits in, `area`), as holes (a ring
 * on the preview is in its hole; holes that overlap would cancel out). */
export function shade(ring: Box | null, preview: Box | null, area: Box | null = null) {
  const rect = (b: Box) => `M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z`;
  let r = ring && grow(ring);
  if (r && area) {   // one hole round both
    const a = grow(area), x = Math.min(a.x, r.x), y = Math.min(a.y, r.y);
    const both = { x, y, w: Math.max(a.x + a.w, r.x + r.w) - x, h: Math.max(a.y + a.h, r.y + r.h) - y };
    if (!overlap(both, preview)) r = both;
  }
  const holes = [preview, r && !overlap(r, preview) ? r : null].filter((b): b is Box => !!b).map(rect).join('');
  return `path(evenodd, "M0 0H${innerWidth}V${innerHeight}H0Z${holes}")`;
}
