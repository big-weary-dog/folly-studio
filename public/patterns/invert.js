// Invert: swaps light and dark, each colour for its opposite: night becomes day, embers ice. amount blends
// from the original; hueOnly keeps the brightness and only turns the colour round the wheel.
const params = {
  amount: { value: 1, min: 0, max: 1, step: 0.01 },
  hueOnly: { value: false, type: 'toggle', label: 'Keep brightness, turn the hue' },
};

function filter(c, q, t, P) {
  const v = max(c[0], c[1], c[2]), lo = min(c[0], c[1], c[2]);
  for (let i = 0; i < 3; i++) {
    const inv = P.hueOnly ? v + lo - c[i] : 1 - c[i];
    c[i] = mix(c[i], inv, P.amount);
  }
  return c;
}
