// Starfield: a deep sky with stars that twinkle in their own time.
const params = {
  density: { value: 0.12, min: 0, max: 1 },
  color: { value: '#c8d8ff', type: 'color' },
  sky: { value: '#1000ff', type: 'color' },
};

function pixel(p, t, P) {
  const star = step(1 - P.density, p.seed) * wave(t * (0.3 + p.seed) + p.seed * 7);
  return mix(P.sky, P.color, star);
}
