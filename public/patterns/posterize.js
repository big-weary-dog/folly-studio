// Posterize: rounds each channel of what is above it to Steps levels, for flat bands of colour (2: each channel on or
// off). Amount blends it with the colour it had.
const params = {
  steps: { value: 4, min: 2, max: 12, step: 1, label: 'Steps per channel',
    help: 'How many levels each colour channel can take. Two is hard on or off; more keeps smoother gradients.' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount',
    help: 'How far the colours snap to the levels. Zero leaves them as they were; one is full banding.' },
};

function filter(c, q, t, P) {
  const n = max(1, round(P.steps) - 1);
  for (let i = 0; i < 3; i++) c[i] = mix(c[i], round(clamp(c[i]) * n) / n, P.amount);
  return c;
}
