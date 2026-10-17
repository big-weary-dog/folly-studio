// Shimmer: each LED glitters on its own smooth random path (rand by p.k) between body and highlight, like
// sequins; any area averages out, so it never flashes. rate, amount (plus energy), sharp (rarer, brighter).
const params = {
  rate: { value: 8, min: 1, max: 20, step: 0.5, label: 'Changes a second' },
  amount: { value: 0.7, min: 0, max: 1, step: 0.01, label: 'Glitter strength' },
  sharp: { value: 3, min: 1, max: 8, step: 0.5, label: 'Sharpness (rarer, brighter glints)' },
};

function pixel(p, t, P, G) {
  const x = t * P.rate * (0.7 + 0.6 * p.seed), i = floor(x);
  const v = pow(mix(rand(p.k, i), rand(p.k, i + 1), smoothstep(0, 1, x - i)), P.sharp);
  return mix(pal('body', fract(p.ly + p.lz * 0.5)), pal('high'), min(1, v * P.amount * (0.5 + G.energy)));
}
