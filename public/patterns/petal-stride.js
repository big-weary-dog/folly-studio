// Petal stride: each petal of the rose window reads every Stride-th petal, its cells kept, so neighbouring colours
// split into spokes. Odd strides read all sixteen petals once each. Off the rose it leaves what is above it alone.
const params = {
  stride: { value: 3, min: 1, max: 15, step: 2, label: 'Stride (petals)',
    help: 'Petal p reads petal p × Stride. 1 changes nothing; 3 or 5 splits colours into spokes; 15 reverses.' },
  offset: { value: 0, min: 0, max: 15, step: 1, label: 'Offset (petals)',
    help: 'Turns where the reading starts by whole petals.' },
};

let cy = 0, cz = 0;
function frame() {
  const c = centres('rose')[0];
  if (c) { cy = c[1]; cz = c[2]; }
}

function warp(q, t, P) {
  if (!q.is('rose') || q.sector < 0) return;
  const stride = 2 * floor(round(P.stride) / 2) + 1, p = q.sector;
  const a = ((p * stride + round(P.offset)) % 16 - p) * TAU / 16;
  const y = q.Y - cy, z = q.Z - cz, Y = cy + y * cos(a) - z * sin(a), Z = cz + z * cos(a) + y * sin(a);
  move(q, q.lx, q.sy ? 0.5 + (Y - q.oy) / (2 * q.sy) : 0.5, q.sz ? 0.5 + (Z - q.oz) / (2 * q.sz) : 0.5);
  slide(q, toward(q, 'along'));
}
