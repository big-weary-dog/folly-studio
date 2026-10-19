// Turbulence: pushes what is above it around with slowly changing noise.
// Amount is how far, as a share of the layer; Size is a swirl's, as a share of the layer; Speed how fast they change.
const params = {
  amount: { value: 0.1, min: 0, max: 0.5, step: 0.01, label: 'Amount' },
  size: { value: 0.33, min: 0.08, max: 2, step: 0.01, label: 'Size (share of the layer)' },
  speed: { value: 0.2, min: 0, max: 2, step: 0.01, label: 'Speed (changes a second)' },
};

function warp(q, t, P) {
  const s = 1 / P.size, w = clock('speed'), x = q.lz * s, y = q.ly * s, z = q.lx * s + w;
  const dx = 2 * P.amount * (fbm(x, y, z, 3) - 0.5), dy = 2 * P.amount * (fbm(x + 31.4, y - 17.2, z, 3) - 0.5);
  move(q, q.lx, q.ly + dy, q.lz + dx);
}
