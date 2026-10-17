// Starfield: every LED a star with its own rhythm (rate, phase and colour from its seed), glinting briefly
// (pulse) over a sky that drifts between two deep blues on slow noise, so the dark is never flat.
const params = {
  rate: { value: 0.35, min: 0.05, max: 3, step: 0.01, label: 'Glints per second' },
  density: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Share of LEDs that are stars' },
  sharp: { value: 0.12, min: 0.02, max: 0.5, step: 0.01, label: 'Glint length' },
  sky: { value: '#08084a', type: 'color' },
  sky2: { value: '#1c0060', type: 'color' },
  star: { value: '#d8f0ff', type: 'color' },
  warm: { value: '#ffd27a', type: 'color' },
};

function pixel(p, t, P) {
  const bed = mix(P.sky, P.sky2, noise(p.lx * 3, p.ly * 3 + t * 0.05, p.lz * 3));
  if (rand(p.k, 1) > P.density) return bed;
  const rate = P.rate * (0.5 + rand(p.k, 2));
  const glint = pulse(p.seed * 13.7 + t * rate, P.sharp);
  return mix(bed, mix(P.star, P.warm, rand(p.k, 3)), glint);
}
