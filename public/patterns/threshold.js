// Threshold: keeps only what is brighter (its brightest channel) than Level, with a soft edge, so busy textures
// become crisp shapes. Recolour gives what is kept the one colour of Colours.
const params = {
  level: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Level' },
  softness: { value: 0.05, min: 0, max: 0.5, step: 0.01, label: 'Edge softness' },
  recolour: { value: false, type: 'toggle', label: 'Recolour' },
  colours: { value: 'all', type: 'color', label: 'Colours' },
};

function filter(c, q, t, P) {
  const v = max(c[0], c[1], c[2]);
  const k = P.softness > 0 ? smoothstep(P.level - P.softness, P.level + P.softness, v) : step(P.level, v);
  for (let i = 0; i < 3; i++) c[i] = (P.recolour ? P.colours[i] : c[i]) * k;
  return c;
}
