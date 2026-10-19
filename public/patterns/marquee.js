// Marquee: theatre bulbs step along every strand: of each `spacing` LEDs, `size` lit, groups alternating body
// and accent over the low colour (xLights). rate (steps a second, plus energy), alternate (every other runs back),
// softness (bulbs fade on and off as the groups step, like filaments).
const params = {
  rate: { value: 6, min: 0.5, max: 20, step: 0.5, label: 'Steps a second' },
  size: { value: 2, min: 1, max: 10, step: 1, label: 'Bulbs lit in each group' },
  spacing: { value: 5, min: 2, max: 20, step: 1, label: 'LEDs per group' },
  alternate: { value: true, type: 'toggle', label: 'Every other strand runs back' },
  softness: { value: 0.4, min: 0, max: 3, step: 0.05, label: 'Bulb fade (LEDs of travel)' },
};

let run = 0, last = 0;
function frame(t, P, G) {
  const dt = t - last, k = P.rate * (0.5 + G.energy);
  run = dt >= 0 && dt < 1 ? run + dt * k : t * k;
  last = t;
}

// Group g lights [g × spacing, g × spacing + size) of `at`; g is the group whose lit bulbs are nearest.
function pixel(p, t, P) {
  const sp = round(P.spacing), half = round(P.size) / 2, s = min(P.softness, sp - 2 * half);
  const at = (P.alternate && p.fixture % 2 ? p.n - 1 - p.i : p.i) - run + 0.5, g = round((at - half) / sp);
  return mix(pal('low', p.u), pal(g & 1 ? 'accent' : 'body', p.u), band(at, g * sp + half, half, s));
}
