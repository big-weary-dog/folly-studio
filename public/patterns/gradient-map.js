// Gradient map: recolours what is above it by its brightness along Colours: dark parts take the first colours,
// bright parts the last. Contrast stretches it; Shift slides along the colours, and Drift slides at that many a
// second (back and forth at the ends).
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount' },
  contrast: { value: 1.2, min: 0.2, max: 4, step: 0.05, label: 'Contrast' },
  shift: { value: 0, min: -1, max: 1, step: 0.01, label: 'Shift' },
  drift: { value: 0, min: -0.5, max: 0.5, step: 0.01, label: 'Drift (a second)' },
};

function filter(c, q, t, P) {
  const v = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const m = pal('colours', tri(((v - 0.5) * P.contrast + 0.5 + P.shift + clock('drift')) / 2));
  for (let i = 0; i < 3; i++) c[i] = mix(c[i], m[i], P.amount);
  return c;
}
