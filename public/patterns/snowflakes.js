// Snowflakes: highlight flakes sway down an accent sky in columns, four deep, and settle in a drift that builds
// then melts. columns (energy brings more), speed, size, cycle (seconds to build and melt).
const params = {
  columns: { value: 24, min: 6, max: 60, step: 1, label: 'Columns across' },
  speed: { value: 0.12, min: 0.02, max: 0.6, step: 0.01, label: 'Fall (layer heights a second)' },
  size: { value: 0.03, min: 0.01, max: 0.08, step: 0.005, label: 'Flake size' },
  cycle: { value: 30, min: 5, max: 120, step: 1, label: 'Seconds to build and melt' },
};

function pixel(p, t, P, G) {
  const n = round(P.columns), deep = floor(p.lx * 3.999), col = floor(p.lz * n);
  let v = 0;
  for (let c = col - 1; c <= col + 1; c++) {
    for (let m = 0; m < 2; m++) {
      if (rand(c, deep * 2 + m, 9) > 0.35 + 0.6 * G.energy) continue;
      const y = 1.05 - fract(t * P.speed * (0.7 + 0.6 * rand(c, deep, m)) + rand(c, m, deep)) * 1.1;
      const z = (c + 0.5 + 0.35 * sin(t * 1.3 + TAU * rand(m, c, deep))) / n;
      v = max(v, smoothstep(P.size, P.size * 0.3, hypot((p.lz - z) * 1.5, p.ly - y)));
    }
  }
  const ph = fract(t / P.cycle), drift = 0.22 * smoothstep(0, 0.7, ph) * (1 - smoothstep(0.85, 1, ph));
  const snow = smoothstep(drift, drift - 0.03, p.ly + 0.03 * noise(p.lz * 8, p.lx * 4));
  return mix(pal('accent', p.ly), pal('high'), max(v, snow));
}
