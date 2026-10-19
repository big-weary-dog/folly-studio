// Recolour: recolours what is above it along Colours by its luminance: dark parts take the first colours, bright parts
// the last. Shade keeps its light and shade (each colour as bright as what it replaces). Contrast stretches the walk;
// Shift slides along the colours, and Drift slides at that many a second (back and forth at the ends). Amount blends
// it with the colour it had.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount' },
  shade: { value: true, type: 'toggle', label: 'Keep light and shade' },
  contrast: { value: 1, min: 0.2, max: 4, step: 0.05, label: 'Contrast' },
  shift: { value: 0, min: -1, max: 1, step: 0.01, label: 'Shift (along the colours)' },
  drift: { value: 0, min: -0.5, max: 0.5, step: 0.01, label: 'Drift (colours a second)' },
};

function filter(c, q, t, P) {
  const v = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];          // luminance: where along the colours
  const m = pal('colours', tri(((v - 0.5) * P.contrast + 0.5 + P.shift + clock('drift')) / 2));
  const k = P.shade ? max(c[0], c[1], c[2]) : 1;
  for (let i = 0; i < 3; i++) c[i] = mix(c[i], m[i] * k, P.amount);
  return c;
}
