// Marquee: theatre bulbs step along every strand: of each `spacing` LEDs, `size` lit, groups alternating body
// and accent over the low colour (xLights). rate (steps a second, plus energy), alternate (every other runs back).
const params = {
  rate: { value: 6, min: 0.5, max: 20, step: 0.5, label: 'Steps a second' },
  size: { value: 2, min: 1, max: 10, step: 1, label: 'Bulbs lit in each group' },
  spacing: { value: 5, min: 2, max: 20, step: 1, label: 'LEDs per group' },
  alternate: { value: true, type: 'toggle', label: 'Every other strand runs back' },
};

let run = 0, last = 0;
function frame(t, P, G) {
  const dt = t - last, k = P.rate * (0.5 + G.energy);
  run = dt >= 0 && dt < 1 ? run + dt * k : t * k;
  last = t;
}

function pixel(p, t, P) {
  const sp = round(P.spacing), at = (P.alternate && p.fixture % 2 ? p.n - 1 - p.i : p.i) - floor(run);
  const grp = floor(at / sp);
  if (at - grp * sp >= round(P.size)) return pal('low', p.u);
  return grp & 1 ? pal('accent', p.u) : pal('body', p.u);
}
