// Gradient map: recolours the chain by luminance across the whole palette, low for the dark through body and
// accent to the highlight. amount, contrast, shift (along the palette), drift (a second; walks back at the ends).
const params = {
  amount: { value: 1, min: 0, max: 1, step: 0.01 },
  contrast: { value: 1.2, min: 0.2, max: 4, step: 0.05 },
  shift: { value: 0, min: -1, max: 1, step: 0.01, label: 'Slide along the palette' },
  drift: { value: 0, min: -0.5, max: 0.5, step: 0.01, label: 'Slide a second' },
};

function filter(c, q, t, P) {
  const v = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const m = palette(tri(((v - 0.5) * P.contrast + 0.5 + P.shift + t * P.drift) / 2));
  for (let i = 0; i < 3; i++) c[i] = mix(c[i], m[i], P.amount);
  return c;
}
