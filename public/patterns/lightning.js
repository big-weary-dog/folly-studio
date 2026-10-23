// Lightning: a forked bolt strikes down about Speed times a second, at random moments, and fades in about
// half a second whatever the Speed: its core the last of Colours, a thin glow the rest. It forks below a random point
// toward where it lands. Under one strike a second, so it stays clear of the flash check. Jag is how much it zigzags.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'The palette of the bolt: its core takes the last colour, its glow the earlier ones.' },
  speed: { value: 0.4, min: 0.1, max: 0.8, step: 0.01, label: 'Speed (strikes a second, on average)',
    help: 'How often a bolt strikes. Low leaves long dark gaps; high strikes nearly every second.' },
  width: { value: 0.06, min: 0.005, max: 0.08, step: 0.005, label: 'Core half-width (share of layer)',
    help: 'How thick the bright core is. Low is a thin crack; high is a fat bolt.' },
  jag: { value: 0.2, min: 0, max: 0.5, step: 0.01, label: 'Zigzag (share of layer width)',
    help: 'How much the bolt zigzags. Zero is a straight line; high is wild and crooked.' },
  glow: { value: 0.04, min: 0, max: 0.15, step: 0.01, label: 'Glow (share of the layer)',
    help: 'How far the haze spreads out around the core. Zero is a bare line; high is a wide halo.' },
};

/** Strike n's light at y, z: it strikes at a random moment of its cycle (x − n: how far into it), so the gaps vary. */
function strike(n, x, y, z, P) {
  const s = (x - n - 0.4 * rand(n, 4)) / max(0.05, P.speed);             // seconds since it struck
  const env = s < 0 ? 0 : s < 0.05 ? s / 0.05 : exp(-(s - 0.05) * 4);
  if (env < 0.01 || y < 1 - s * 14) return 0;                            // faded, or not reached yet (from y 1)
  const at = 0.15 + 0.7 * rand(n, 1) + P.jag * (2 * noise(y * 4, n * 3.1) - 1 + 0.4 * (2 * noise(y * 17, n * 5.3) - 1));
  const split = 0.25 + 0.4 * rand(n, 2);
  const fork = y < split ? abs(z - at - (split - y) * (rand(n, 3) - 0.5) * 1.6) : 1;  // below split, toward the ground
  const gap = min(abs(z - at), fork);
  const halo = P.glow > 0 ? exp(-gap / max(0.01, P.glow)) * 0.8 : 0;
  return max(smoothstep(P.width, P.width * 0.3, gap), halo) * env;
}

function pixel(p, t, P) {
  const x = clock('speed'), n = floor(x);
  const y = p.ly, z = p.lz;
  const v = max(strike(n, x, y, z, P), strike(n - 1, x, y, z, P));          // the last strike may still be fading
  if (v < 0.004) return null;
  const c = pal('colours', v);
  c[3] = v;
  return c;
}
