// Invert: swaps light and dark in what is above it, each colour for its opposite; Hue only keeps the brightness and
// turns the colour round the wheel. Amount blends it with the colour it had.
const params = {
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount' },
  hueOnly: { value: false, type: 'toggle', label: 'Hue only' },
};

function filter(c, q, t, P) {
  const v = max(c[0], c[1], c[2]), lo = min(c[0], c[1], c[2]);
  for (let i = 0; i < 3; i++) {
    const inv = P.hueOnly ? v + lo - c[i] : 1 - c[i];
    c[i] = mix(c[i], inv, P.amount);
  }
  return c;
}
