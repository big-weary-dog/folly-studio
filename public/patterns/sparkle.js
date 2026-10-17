// Sparkle: seeded highlight glints added as light on top of the chain, like frost; a glint lights alpha too.
// density (share of LEDs, by rand(p.k); more with energy), rate (glints a second), length.
const params = {
  density: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Share of LEDs that glint' },
  rate: { value: 0.6, min: 0.05, max: 4, step: 0.01, label: 'Glints a second' },
  length: { value: 0.15, min: 0.02, max: 0.5, step: 0.01, label: 'Glint length' },
};

function filter(c, q, t, P, G) {
  if (rand(q.k, 11) > P.density * (0.5 + G.energy)) return c;
  const g = pulse(rand(q.k, 12) * 9.7 + t * P.rate * (0.5 + rand(q.k, 13)), P.length);
  if (g <= 0) return c;
  const h = pal('high'), A = max(c[3], g);
  for (let i = 0; i < 3; i++) c[i] = min(1, (c[i] * c[3] + h[i] * g) / A);
  c[3] = A;
  return c;
}
