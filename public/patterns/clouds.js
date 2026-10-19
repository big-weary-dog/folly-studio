// Clouds: soft billows drift in Direction at Speed, clear where they thin, thickest in the last of Colours.
// Cover is how much of the layer they fill; Size is their scale (more is smaller).
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  direction: { value: 'left', type: 'choice', options: DIRECTIONS, label: 'Direction' },
  speed: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Speed' },
  cover: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Cover' },
  scale: { value: 2.5, min: 0.5, max: 8, step: 0.1, label: 'Size (more is smaller)' },
};

function pixel(p, t, P) {
  const s = P.scale, d = P.direction, m = toward(p, d) * s - clock('speed');   // the noise moves along Direction
  const n = d === 'up' || d === 'down' ? fbm(p.lz * s, m * 0.6, p.lx * s * 0.5)
    : d === 'right' || d === 'left' ? fbm(m, p.ly * s * 0.6, p.lx * s * 0.5) : fbm(p.lz * s, p.ly * s * 0.6, m * 0.5);
  const edge = 1 - P.cover, v = smoothstep(edge - 0.15, edge + 0.15, n);
  if (v <= 0.002) return null;
  const c = pal('colours', v);
  c[3] = v;
  return c;
}
