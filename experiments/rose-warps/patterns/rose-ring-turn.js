// Rose ring turn: offsets each successive ring by more petals, optionally alternating its direction.
const params = {
  step: { value: 1, min: -8, max: 8, step: 1, label: 'Petals per ring',
    help: 'Each ring adds this many petals to the offset. 1 makes a stepped spiral.' },
  alternate: { value: false, type: 'toggle', label: 'Alternate',
    help: 'Turn alternate rings in opposite directions.' },
  speed: { value: 0, min: -2, max: 2, step: 0.1, label: 'Speed (petals a second per ring)',
    help: 'Advance the twist one whole petal at a time. 0 holds the rings still.' },
};
let cy = 0, cz = 0;
function frame() {
  const c = centres('rose')[0];
  if (c) { cy = c[1]; cz = c[2]; }
}
function warp(q, t, P) {
  if (!q.is('rose') || q.ring < 1) return;
  const r = q.ring - 1, sign = P.alternate && r % 2 ? -1 : 1;
  const a = -sign * r * (round(P.step) + floor(clock('speed'))) * TAU / 16;
  const y = q.Y - cy, z = q.Z - cz;
  const Y = cy + y * cos(a) - z * sin(a), Z = cz + z * cos(a) + y * sin(a);
  move(q, q.lx, q.sy ? 0.5 + (Y - q.oy) / (2 * q.sy) : 0.5,
    q.sz ? 0.5 + (Z - q.oz) / (2 * q.sz) : 0.5);
  slide(q, toward(q, 'along'));
}
