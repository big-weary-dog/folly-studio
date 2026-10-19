// Tint: recolours what is above it from Colours, keeping its light and shade: brighter parts walk further along
// the colours (by Spread). Amount blends it with the colour it had.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount' },
  spread: { value: 1, min: 0, max: 1, step: 0.01, label: 'Spread' },
};

function filter(c, q, t, P) {
  const v = max(c[0], c[1], c[2]), tint = pal('colours', v * P.spread);
  for (let i = 0; i < 3; i++) c[i] = mix(c[i], tint[i] * v, P.amount);
  return c;
}
