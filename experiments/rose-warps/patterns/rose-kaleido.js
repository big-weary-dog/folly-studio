// Rose kaleido: copies one selected petal onto every petal, optionally reflecting alternate copies.
const params = {
  petal: { value: 0, min: 0, max: 15, step: 1, label: 'Source petal',
    help: 'Which petal to repeat all the way round the rose.' },
  mirror: { value: true, type: 'toggle', label: 'Mirror',
    help: 'Reflect alternate petals across their centre line.' },
  speed: { value: 0, min: -2, max: 2, step: 0.1, label: 'Speed (source petals a second)',
    help: 'Step through the source petals. 0 keeps the chosen petal.' },
};
let cy = 0, cz = 0;
function frame() {
  const c = centres('rose')[0];
  if (c) { cy = c[1]; cz = c[2]; }
}
function warp(q, t, P) {
  if (!q.is('rose') || q.sector < 0) return;
  const p = q.sector, target = round(P.petal) + floor(clock('speed'));
  const base = p * TAU / 16, a = (target - p) * TAU / 16;
  let y = q.Y - cy, z = q.Z - cz;
  if (P.mirror && p % 2) {
    const along = y * cos(base) + z * sin(base), side = z * cos(base) - y * sin(base);
    y = along * cos(base) + side * sin(base); z = along * sin(base) - side * cos(base);
  }
  const Y = cy + y * cos(a) - z * sin(a), Z = cz + z * cos(a) + y * sin(a);
  move(q, q.lx, q.sy ? 0.5 + (Y - q.oy) / (2 * q.sy) : 0.5,
    q.sz ? 0.5 + (Z - q.oz) / (2 * q.sz) : 0.5);
  slide(q, toward(q, 'along'));
}
