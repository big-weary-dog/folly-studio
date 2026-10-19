// Invert: swaps light and dark in what is above it, each colour for its opposite (to turn only the hue, hue-shift by
// half a turn). Amount blends it with the colour it had.
const params = {
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount' },
};

function filter(c, q, t, P) {
  for (let i = 0; i < 3; i++) c[i] = mix(c[i], 1 - c[i], P.amount);
  return c;
}
