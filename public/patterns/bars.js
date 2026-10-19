// Bars: bands of body and accent colour march across the layer edge to edge (xLights' Bars). speed (plus
// energy, via frame()'s clock), bars, direction (up, down, across, front to back, out, in), softness (each edge).
const params = {
  speed: { value: 0.4, min: -2, max: 2, step: 0.01, label: 'Bars a second' },
  bars: { value: 4, min: 1, max: 16, step: 1, label: 'Bars across the layer' },
  direction: { value: 0, min: 0, max: 6, step: 1, label: 'Up, down, →, ←, front → back, out, in' },
  softness: { value: 0.2, min: 0, max: 1, step: 0.01, label: 'Edge softness (share of a bar)' },
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
  const d = round(P.direction), mid = min(1, hypot(p.lz - 0.5, p.ly - 0.5) * 2);
  const x = d === 0 ? p.ly : d === 1 ? 1 - p.ly : d === 2 ? p.lz : d === 3 ? 1 - p.lz : d === 4 ? p.lx
    : d === 5 ? mid : 1 - mid;
  const f = x * P.bars - run, b = round(f);                 // b: the nearest edge, bar b − 1 below it, bar b above
  return mix(swatch(b - 1), swatch(b), soft(b, f, P.softness));
}
