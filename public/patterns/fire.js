// Fire: flames lick up from the bottom of the layer: 3D fbm scrolling upward, cooled with height, maps ember
// red through orange to white-hot; embers keeps the cool parts glowing instead of going out.
const params = {
  speed: { value: 1.2, min: 0, max: 4, step: 0.05, label: 'Rise speed' },
  height: { value: 0.75, min: 0.2, max: 1.5, step: 0.01, label: 'Flame height' },
  scale: { value: 3, min: 0.5, max: 8, step: 0.1, label: 'Flame size (smaller is bigger)' },
  embers: { value: 0.12, min: 0, max: 0.4, step: 0.01 },
};

const FIRE = ['#3a0000', '#d00000', '#ff3c00', '#ff9000', '#ffd640', '#fff6d8'];

function pixel(p, t, P) {
  const h = fbm(p.lz * P.scale, p.ly * P.scale * 1.4 - t * P.speed, p.lx * P.scale + t * 0.2);
  const heat = clamp(h * 1.6 - p.ly / P.height + 0.25);
  return gradient(max(heat, P.embers), FIRE);
}
