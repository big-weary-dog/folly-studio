// Strobe: flashes the layer on a beat over the low colour, accent toward highlight with energy. Defaults to 2 a
// second; over 3 a second on a large area fails the bake's flash check. rate, length (lit share of a beat),
// scatter (0 the whole layer; up to 1, a random tenth of it each beat), softness (the flash's fade out, an afterglow).
const params = {
  rate: { value: 2, min: 0.25, max: 8, step: 0.25, label: 'Flashes a second (over 3 fails the flash check)' },
  length: { value: 0.15, min: 0.05, max: 0.5, step: 0.01, label: 'Lit share of each beat' },
  scatter: { value: 0, min: 0, max: 1, step: 0.01, label: 'Scatter (0: the whole layer at once)' },
  softness: { value: 0.04, min: 0, max: 0.25, step: 0.01, label: 'Fade out (share of a beat)' },
};

function pixel(p, t, P, G) {
  const x = t * P.rate, n = floor(x), s = min(P.softness, P.length);
  if (P.scatter > 0 && rand(p.k, n) < P.scatter * 0.9) return pal('low', p.ly);
  const on = 1 - soft(P.length - s / 2, x - n, s);          // full on the beat, fading out by the end of `length`
  return mix(pal('low', p.ly), mix(pal('accent', p.u), pal('high'), G.energy), on);
}
