// Threshold: lights only what is brighter than a level, so busy textures become crisp shapes.
//
// The chain's brightness (its brightest channel) against `level`, with a soft edge of `softness`
// either side. Kept parts stay their own colour, or all take `color` when `recolour` is on.
const params = {
  level: { value: 0.5, min: 0, max: 1, step: 0.01 },
  softness: { value: 0.05, min: 0, max: 0.5, step: 0.01, label: 'Edge softness' },
  recolour: { value: false, type: 'toggle', label: 'One colour for what is kept' },
  color: { value: '#ffd27a', type: 'color' },
};

function filter(c, q, t, P) {
  const v = max(c[0], c[1], c[2]);
  const k = P.softness > 0 ? smoothstep(P.level - P.softness, P.level + P.softness, v) : step(P.level, v);
  for (let i = 0; i < 3; i++) c[i] = (P.recolour ? P.color[i] : c[i]) * k;
  return c;
}
