// Rose shift: moves whole petals clockwise, or swaps adjacent blocks of petals.
const params = {
  offset: { value: 1, min: 0, max: 15, step: 1, label: 'Petals',
    help: 'How many petals clockwise to move the pattern.' },
  swap: { value: false, type: 'toggle', label: 'Swap blocks',
    help: 'Swap adjacent blocks of Petals instead of rotating the whole rose. Use 1, 2, 4 or 8.' },
  speed: { value: 0, min: -4, max: 4, step: 0.1, label: 'Speed (petals a second)',
    help: 'Step the offset over time. 0 holds it still.' },
};
let cy = 0, cz = 0;
function frame() {
  const c = centres('rose')[0];
  if (c) { cy = c[1]; cz = c[2]; }
}
function warp(q, t, P) {
  if (!q.is('rose') || q.sector < 0) return;
  const p = q.sector, n = max(1, round(P.offset));
  const s = P.swap ? (floor(p / n) % 2 ? -n : n) : -round(P.offset) - floor(clock('speed'));
  const a = s * TAU / 16, y = q.Y - cy, z = q.Z - cz;
  const Y = cy + y * cos(a) - z * sin(a), Z = cz + z * cos(a) + y * sin(a);
  move(q, q.lx, q.sy ? 0.5 + (Y - q.oy) / (2 * q.sy) : 0.5,
    q.sz ? 0.5 + (Z - q.oz) / (2 * q.sz) : 0.5);
  slide(q, toward(q, 'along'));
}
