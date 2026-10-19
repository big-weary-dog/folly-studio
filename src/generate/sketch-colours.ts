// sketch's colours (SPEC "Palettes"): the idea's colour words choose the look palette nearest them in hue, and each
// becomes the nearest swatch's slot (`accent2`) when one is close, else itself; a pattern without colour params hears
// them through its layer's role remap.
import PALETTES from '../../public/data/palettes.json' with { type: 'json' };

type Palette = (typeof PALETTES.palettes)[number];
const ROLES = ['low', 'body', 'accent', 'high'] as const;
const VIVID = 0.35, HUE = 0.05;           // saturated enough to have a hue; a hue tolerance (18°), in turns

function hsvOf(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const v = Math.max(r, g, b), d = v - Math.min(r, g, b);
  const h = !d ? 0 : v === r ? (g - b) / d / 6 : v === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  return { h: h - Math.floor(h), s: v ? d / v : 0, v };
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));

/** How far a colour is from a swatch: by hue for vivid colours, by saturation and value for pale and grey ones;
 * Infinity beyond the tolerance. */
function gap(hex: string, swatch: string) {
  const a = hsvOf(hex), b = hsvOf(swatch);
  if (a.s >= VIVID) return b.s >= VIVID * 0.8 && Math.abs(a.v - b.v) <= 0.5 && hueGap(a.h, b.h) <= HUE
    ? hueGap(a.h, b.h) : Infinity;
  return b.s < VIVID && Math.abs(a.s - b.s) <= 0.15 && Math.abs(a.v - b.v) <= 0.2
    ? Math.abs(a.s - b.s) + Math.abs(a.v - b.v) : Infinity;
}

/** The palette whose vivid body and accent colours come nearest the vivid colours named (by hue; ties keep chapel,
 * the default), or null when none is vivid. */
export function choosePalette(hexes: readonly string[]): Palette | null {
  const vivid = hexes.filter((c) => hsvOf(c).s >= VIVID);
  if (!vivid.length) return null;
  const score = (p: Palette) => vivid.reduce((sum, c) => sum + Math.min(0.5, ...[...p.body, ...p.accent]
    .filter((s) => hsvOf(s).s >= VIVID).map((s) => hueGap(hsvOf(c).h, hsvOf(s).h))), 0);
  const list = [...PALETTES.palettes].sort((a, b) => Number(b.name === 'chapel') - Number(a.name === 'chapel'));
  return list.reduce((best, p) => (score(p) < score(best) ? p : best));
}

/** A colour as the slot of `palette` nearest it (`body2`), when one is within tolerance; else the colour itself. */
export function slotFor(hex: string, palette: Palette | null): string {
  let best = '', far = Infinity;
  for (const role of ROLES) {
    palette?.[role].forEach((swatch, i) => {
      const d = gap(hex, swatch);
      if (d < far) [best, far] = [`${role}${i + 1}`, d];
    });
  }
  return best || hex;
}

/** A layer's remap for a pattern that only reads the palette: colours set "on" or "behind" something its low, the
 * rest its body; undefined for none. */
export function remapFor(colours: readonly { hex: string, behind: boolean }[], palette: Palette | null) {
  const of = (behind: boolean) => [...new Set(colours.filter((c) => c.behind === behind)
    .map((c) => slotFor(c.hex, palette)))].join(' ');
  const low = of(true), body = of(false);
  return low || body ? { ...(low ? { low } : {}), ...(body ? { body } : {}) } : undefined;
}
