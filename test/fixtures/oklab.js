// A colour fade in OKLab, written out with exact pow as the reference for core/oklab.ts's tabled one: each colour's
// light (v^2.2), Björn Ottosson's OKLab, straight across, and back, clamped to [0, 1].
const lab = (c) => {
  const [r, g, b] = c.map((v) => Math.sign(v) * Math.abs(v) ** 2.2);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
/** The colour t of the way from a to b. */
export function fade(a, b, t) {
  const p = lab(a), q = lab(b), [L, A, B] = p.map((v, i) => v + (q[i] - v) * t);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m
    - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map((x) => Math.min(1, Math.max(0, x)) ** (1 / 2.2));
}
