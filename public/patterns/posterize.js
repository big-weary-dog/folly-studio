// Posterize: rounds each channel of what is above it to Steps levels, for flat bands of colour (2: each channel on or
// off). Amount blends it with the colour it had.
const params = {
  steps: { value: 4, min: 2, max: 12, step: 1, label: 'Steps per channel' },
  mix: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount' },
};

function filter(c, q, t, P) {
  const n = max(1, round(P.steps) - 1);
  for (let i = 0; i < 3; i++) c[i] = mix(c[i], round(clamp(c[i]) * n) / n, P.mix);
  return c;
}
