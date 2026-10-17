// Palette drift: a calm bed of full-strength colour whose hues slowly travel.
//
// Hue varies a little with depth and height (and with a soft fbm swirl), and the whole palette
// turns over time. Saturation stays high and value at full, so it reads as colour, not dimness.
// A good bottom layer to stack sweeps, sparkles or chases on.
const params = {
  hue: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Starting hue' },
  drift: { value: 0.02, min: 0, max: 0.2, step: 0.005, label: 'Hue turns per second' },
  spread: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Hue spread across the layer' },
  swirl: { value: 0.12, min: 0, max: 0.5, step: 0.01 },
  saturation: { value: 1, min: 0.5, max: 1, step: 0.01 },
};

function pixel(p, t, P) {
  const h = P.hue + t * P.drift
          + P.spread * (0.6 * p.lx + 0.4 * p.ly)
          + P.swirl * (fbm(p.lx * 2, p.ly * 2, p.lz * 2 + t * 0.05) - 0.5);
  return hsv(h, P.saturation, 1);
}
