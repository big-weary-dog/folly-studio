// Lightning: a forked bolt strikes in Direction at Speed and fades, its core the last of Colours, its glow the rest.
// Under one strike a second, so it stays clear of the flash check. Jag is how much it zigzags.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  direction: { value: 'down', type: 'choice', options: DIRECTIONS, label: 'Direction' },
  speed: { value: 0.4, min: 0.1, max: 0.8, step: 0.01, label: 'Speed (strikes a second)' },
  width: { value: 0.035, min: 0.005, max: 0.08, step: 0.005, label: 'Bolt width' },
  jag: { value: 0.2, min: 0, max: 0.5, step: 0.01, label: 'Jag' },
  glow: { value: 0.15, min: 0, max: 0.4, step: 0.01, label: 'Glow' },
};

function pixel(p, t, P) {
  const x = clock('speed'), n = floor(x), f = x - n;                      // strike n, f of the way to the next
  const d = P.direction, y = 1 - toward(p, d), z = d === 'right' || d === 'left' ? p.ly : p.lz;
  const env = f < 0.02 ? f / 0.02 : exp(-(f - 0.02) * 10);
  if (env < 0.01 || y < 1 - f * 35) return null;                         // faded, or not reached yet
  const at = 0.15 + 0.7 * rand(n, 1) + P.jag * (2 * noise(y * 4, n * 3.1) - 1 + 0.4 * (2 * noise(y * 17, n * 5.3) - 1));
  const split = 0.25 + 0.4 * rand(n, 2);
  const fork = y < split ? abs(z - at - (split - y) * (rand(n, 3) - 0.5) * 1.6) : 1;
  const gap = min(abs(z - at), fork);
  const v = max(smoothstep(P.width, P.width * 0.3, gap), exp(-gap / max(0.01, P.glow)) * 0.8) * env;
  if (v < 0.004) return null;
  const c = pal('colours', v);
  c[3] = v;
  return c;
}
