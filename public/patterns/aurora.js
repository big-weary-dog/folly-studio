// Aurora: slow curtains of green and violet over a night-blue sky, never black. Fractal noise (fbm) across
// width and depth places the curtains, a finer noise stretched upward draws their rays, height walks the colour.
const params = {
  speed: { value: 1, min: 0, max: 4, step: 0.05 },
  amount: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'How much sky the curtains cover' },
  sky: { value: '#06104a', type: 'color' },
  low: { value: '#00ff6a', type: 'color' },
  mid: { value: '#00d0ff', type: 'color' },
  high: { value: '#b000ff', type: 'color' },
};

function pixel(p, t, P) {
  const s = t * P.speed;
  const n = fbm(p.lz * 2 + s * 0.06, p.lx * 2 - s * 0.03, s * 0.05);
  const edge = 1 - P.amount;
  const curtain = smoothstep(edge - 0.12, edge + 0.12, n);
  const rays = noise(p.lz * 16 + n * 6, p.lx * 4, s * 0.25);
  const glow = curtain * (0.5 + 0.5 * rays);
  const c = gradient(clamp(p.ly * 0.85 + (n - 0.5) * 0.8), [P.low, P.mid, P.high]);
  return mix(P.sky, c, glow);
}
