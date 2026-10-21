// Clouds: soft billows drift in Direction at Speed, clear where they thin, thickest in the last of Colours.
// Cover is how much of the layer they fill; Size is a cloud's, as a share of the layer.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'Which palette colours the clouds, from their thin edges to their thickest parts.' },
  direction: { value: 'left', type: 'choice', label: 'Direction',
    options: ['up', 'down', 'right', 'left'],
    help: 'Which way the clouds drift across the layer.' },
  speed: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Speed (clouds a second)',
    help: 'How fast the clouds drift. 0 holds them still; high blows them past quickly.' },
  cover: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Cover',
    help: 'How much of the layer the clouds fill. Low leaves scattered wisps; high covers nearly all of it.' },
  size: { value: 0.4, min: 0.12, max: 2, step: 0.01, label: 'Size (share of the layer)',
    help: 'How big each cloud is. Small gives a busy, mottled sky; large gives broad billows.' },
};

function pixel(p, t, P) {
  const s = 1 / P.size, d = P.direction, m = toward(p, d) * s - clock('speed');   // the noise moves along Direction
  const n = d === 'up' || d === 'down' ? fbm(p.lz * s, m, p.lx * s * 0.5)
    : fbm(m, p.ly * s * 0.6, p.lx * s * 0.5);
  const edge = 0.78 - 0.5 * P.cover, v = smoothstep(edge - 0.15, edge + 0.15, n);   // fbm sits in about 0.3-0.75
  if (v <= 0.002) return null;
  const c = pal('colours', v);
  c[3] = v;
  return c;
}
