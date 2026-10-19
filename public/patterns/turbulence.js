// Turbulence: pushes what is above it around with slowly changing noise.
// Amount is how far, as a share of the layer; Size sets the swirls (more is smaller); Speed is how fast they change.
const params = {
  amount: { value: 0.1, min: 0, max: 0.5, step: 0.01, label: 'Amount' },
  size: { value: 3, min: 0.5, max: 12, step: 0.1, label: 'Size (more is smaller)' },
  speed: { value: 0.2, min: 0, max: 2, step: 0.01, label: 'Speed' },
};

function warp(q, t, P) {
  const s = P.size, w = clock('speed'), x = q.lz * s, y = q.ly * s, z = q.lx * s + w;
  const dx = 2 * P.amount * (fbm(x, y, z, 3) - 0.5), dy = 2 * P.amount * (fbm(x + 31.4, y - 17.2, z, 3) - 0.5);
  move(q, q.lx, q.ly + dy, q.lz + dx);
}
