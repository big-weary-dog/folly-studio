// Lightning: every `every` seconds a forked bolt zigzags down (noise, `jag`) in the highlight with an accent
// glow (wider with energy) over a rolling storm sky at `sky`; one strike, no stutter, under one a second, so it
// stays clear of the flash check. width, jag, glow.
const params = {
  every: { value: 2.5, min: 1.2, max: 10, step: 0.1, label: 'Seconds between strikes' },
  width: { value: 0.035, min: 0.005, max: 0.08, step: 0.005, label: 'Bolt width' },
  jag: { value: 0.2, min: 0, max: 0.5, step: 0.01, label: 'Zigzag' },
  glow: { value: 0.15, min: 0, max: 0.4, step: 0.01, label: 'Glow round the bolt' },
  sky: { value: 0.4, min: 0, max: 1, step: 0.01, label: 'Sky brightness' },
};

function pixel(p, t, P, G) {
  const x = t / P.every, n = floor(x), a = (x - n) * P.every;          // seconds since strike n
  const sky = scale(mix(pal('low', p.ly), pal('accent', 0), 0.5 * fbm(p.lz * 2 + t * 0.05, p.ly * 2, p.lx)), P.sky);
  const env = a < 0.05 ? a / 0.05 : exp(-(a - 0.05) * 4);
  if (env < 0.01 || p.ly < 1 - a * 14) return sky;                        // not struck, or not reached yet
  const z = 0.15 + 0.7 * rand(n, 1)
    + P.jag * (2 * noise(p.ly * 4, n * 3.1) - 1 + 0.4 * (2 * noise(p.ly * 17, n * 5.3) - 1));
  const split = 0.25 + 0.4 * rand(n, 2);
  const fork = p.ly < split ? abs(p.lz - z - (split - p.ly) * (rand(n, 3) - 0.5) * 1.6) : 1;
  const d = min(abs(p.lz - z), fork);
  const halo = exp(-d / max(0.01, P.glow * (0.5 + G.energy))) * 0.8;
  return mix(mix(sky, pal('accent', 1), halo * env), pal('high'), smoothstep(P.width, P.width * 0.3, d) * env);
}
