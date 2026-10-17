// The look's palette (SPEC "Globals"): roles low · body · accent · high, the stdlib's pal() and palette(),
// and RUN, what the frame being rendered shares with pattern code (its G and palette). No imports: the
// stdlib imports this.

export const PALETTE_ROLES = Object.freeze(['low', 'body', 'accent', 'high']);
/** `chapel` from data/palettes.json: what a look without a palette plays in. */
export const DEFAULT_PALETTE = Object.freeze({ name: 'chapel', low: ['#a30066', '#d40063'],
  body: ['#ff333c', '#fd7f40', '#fcae5c', '#fbd182'], accent: ['#2a39ff', '#2380ff', '#50b3ff'], high: ['#f9e5c4'] });
const MAX_PER_ROLE = 16;
const HEX6 = /^#[0-9a-f]{6}$/i;

function rgbOf(s) {
  const v = parseInt(s.slice(1), 16);
  return Object.freeze([((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]);
}

/**
 * A palette (`{ name?, low: ['#hex'], … }`) as G.palette: { name, low, body, accent, high, all }, each a frozen
 * list of frozen [r, g, b] (`all`: every colour, low to high). Bad colours are skipped; no colours → the default.
 */
export function paletteColours(palette) {
  const src = palette && typeof palette === 'object' ? palette : DEFAULT_PALETTE;
  const out = { name: typeof src.name === 'string' ? src.name.slice(0, 64) : '' };
  const all = [];
  for (const role of PALETTE_ROLES) {
    const list = Array.isArray(src[role]) ? src[role].filter((c) => typeof c === 'string' && HEX6.test(c)) : [];
    out[role] = Object.freeze(list.slice(0, MAX_PER_ROLE).map(rgbOf));
    all.push(...out[role]);
  }
  if (!all.length) return src === DEFAULT_PALETTE ? null : paletteColours(DEFAULT_PALETTE);
  out.all = Object.freeze(all);
  return Object.freeze(out);
}

/** What the frame being rendered shares with the stdlib and use(): set by renderFrame. */
export const RUN = { G: null, palette: paletteColours(DEFAULT_PALETTE) };

function ramp(list, t) {
  const n = list.length;
  if (n === 1 || !(t > 0)) return [list[0][0], list[0][1], list[0][2]];
  const f = (t < 1 ? t : 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f)), k = f - i, a = list[i], b = list[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** pal(role, t = 0): the look's palette role `low|body|accent|high` (else body), t 0..1 across its colours. */
export function pal(role, t = 0) {
  const p = RUN.palette;
  let list = p[role];
  if (!list || !list.length) list = p.body.length ? p.body : p.all;
  return ramp(list, t);
}

/** palette(t): t 0..1 across all of the look's palette colours, low to high. */
export function palette(t) { return ramp(RUN.palette.all, t); }
