// Rose stride: visits every kth petal, preserving the cell's place inside its petal.
const params = {
  stride: { value: 's3', type: 'choice', options: ['s1', 's3', 's5', 's7', 's9', 's11', 's13', 's15'], label: 'Stride',
    help: 'Read every kth petal. Odd strides visit all sixteen exactly once; 15 reverses their order.' },
  offset: { value: 0, min: 0, max: 15, step: 1, label: 'Offset (petals)',
    help: 'Which source petal to start with.' },
};
const strides = { s1: 1, s3: 3, s5: 5, s7: 7, s9: 9, s11: 11, s13: 13, s15: 15 };
let cy = 0, cz = 0;
function frame() {
  const c = centres('rose')[0];
  if (c) { cy = c[1]; cz = c[2]; }
}
function warp(q, t, P) {
  if (!q.is('rose') || q.sector < 0) return;
  const p = q.sector, target = (p * strides[P.stride] + round(P.offset)) % 16;
  const a = (target - p) * TAU / 16, y = q.Y - cy, z = q.Z - cz;
  const Y = cy + y * cos(a) - z * sin(a), Z = cz + z * cos(a) + y * sin(a);
  move(q, q.lx, q.sy ? 0.5 + (Y - q.oy) / (2 * q.sy) : 0.5,
    q.sz ? 0.5 + (Z - q.oz) / (2 * q.sz) : 0.5);
  slide(q, toward(q, 'along'));
}
