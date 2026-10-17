// Posterize: rounds each colour channel to a few steps, for flat, poster-like bands of colour.
//
// `steps` levels per channel (2 is pure on/off colour); `mix` blends back toward the original, so
// a smooth gradient can keep a little of its glow.
const params = {
  steps: { value: 4, min: 2, max: 12, step: 1, label: 'Steps per channel' },
  mix: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount' },
};

function filter(c, q, t, P) {
  const n = max(1, round(P.steps) - 1);
  for (let i = 0; i < 3; i++) c[i] = mix(c[i], round(clamp(c[i]) * n) / n, P.mix);
  return c;
}
