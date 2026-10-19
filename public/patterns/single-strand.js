// Single strand: bands of body and accent chase along every strand, a `gap` of each at the low colour
// (xLights). speed (LEDs a second, plus energy), size (LEDs a band), mode (along, bounce, out, in), softness.
const params = {
  speed: { value: 20, min: -150, max: 150, step: 1, label: 'LEDs a second' },
  size: { value: 10, min: 1, max: 60, step: 1, label: 'LEDs per band' },
  gap: { value: 0.3, min: 0, max: 0.9, step: 0.01, label: 'Share of each band left low' },
  mode: { value: 0, min: 0, max: 3, step: 1, label: 'Along, back and forth, out from middle, in to middle' },
  softness: { value: 1.5, min: 0, max: 10, step: 0.1, label: 'Edge softness (LEDs)' },
};

let run = 0, last = 0;
function frame(t, P, G) {
  const dt = t - last, k = P.speed * (0.5 + G.energy);
  run = dt >= 0 && dt < 1 ? run + dt * k : t * k;
  last = t;
}

// The i-th band: body and accent colours in turn, spread along each role.
const swatch = (i) => pal(i & 1 ? 'accent' : 'body', fract(i * 0.618));

function pixel(p, t, P, G) {
  const m = round(P.mode), h = (p.n - 1) / 2;
  const x = m === 2 ? abs(p.i - h) : m === 3 ? h - abs(p.i - h) : p.i;
  const shift = m === 1 ? tri(run / (2 * p.n)) * p.n : run;
  // Band b: its first `gap` low, then its colour; g is half the gap, b the band whose low part is nearest.
  const f = (x - shift) / P.size, g = P.gap / 2, b = round(f - g), s = min(P.softness / P.size, 1 - P.gap);
  const c = mix(swatch(b - 1), swatch(b), soft(b + g, f, s));
  return mix(c, pal('low', p.u), band(f, b + g, g, s));
}
