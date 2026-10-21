// Colour fades (SPEC-library "Palettes", docs/LIGHT.md): mix(), gradient(), palette ramps and pick crossfades go
// from one colour to another in OKLab, where a fade keeps its brightness and passes through the hues between, instead
// of dipping dark and muddy as a fade of encoded values does. Encoded value → light (the engine's fixed 2.2) → OKLab
// (Björn Ottosson's), straight across, and back; out of gamut, each channel is clamped to 0..1, or to an end beyond.
import { toLight, toValue } from './light.ts';

type Colour = ArrayLike<number>;
// Each side's last colour and its OKLab (value, then OKLab): a fade's ends repeat from pixel to pixel.
const PA = new Float64Array(6).fill(NaN), PB = new Float64Array(6).fill(NaN);

/** c's OKLab into memo[3..5], unless memo[0..2] already holds c. */
function labOf(c: Colour, memo: Float64Array) {
  const c0 = c[0], c1 = c[1], c2 = c[2];
  if (c0 === memo[0] && c1 === memo[1] && c2 === memo[2]) return memo;
  memo[0] = c0; memo[1] = c1; memo[2] = c2;
  const r = toLight(c0), g = toLight(c1), b = toLight(c2);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  memo[3] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  memo[4] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  memo[5] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return memo;
}

const within = (v: number, a: number, b: number) => {
  const lo = a < b ? a : b, hi = a < b ? b : a;
  return v < (lo < 0 ? lo : 0) ? (lo < 0 ? lo : 0) : v > (hi > 1 ? hi : 1) ? (hi > 1 ? hi : 1) : v;
};

/** The colour t of the way from a to b (t outside 0..1 runs on past them), into out: a fade in OKLab. */
export function fadeInto<T extends number[]>(a: Colour, b: Colour, t: number, out: T): T {
  if (t === 0 || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2])) {
    out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out;
  }
  if (t === 1) { out[0] = b[0]; out[1] = b[1]; out[2] = b[2]; return out; }
  const p = labOf(a, PA), q = labOf(b, PB);
  const L = p[3] + (q[3] - p[3]) * t, A = p[4] + (q[4] - p[4]) * t, B = p[5] + (q[5] - p[5]) * t;
  const l1 = L + 0.3963377774 * A + 0.2158037573 * B, m1 = L - 0.1055613458 * A - 0.0638541728 * B;
  const s1 = L - 0.0894841775 * A - 1.291485548 * B, l = l1 * l1 * l1, m = m1 * m1 * m1, s = s1 * s1 * s1;
  const r = toValue(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = toValue(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = toValue(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  out[0] = within(r, a[0], b[0]); out[1] = within(g, a[1], b[1]); out[2] = within(bl, a[2], b[2]);
  return out;
}
