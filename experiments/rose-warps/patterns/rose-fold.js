// Rose fold: repeats a block of petals around the rose, reflecting alternate blocks.
const params = {
  repeats: { value: 'four', type: 'choice', options: ['two', 'four', 'eight', 'sixteen'], label: 'Repeats',
    help: 'How many copies fit around the rose. 4 keeps four source petals in each copy.' },
  offset: { value: 0, min: 0, max: 15, step: 1, label: 'Source petal',
    help: 'The first petal of the block to copy.' },
  mirror: { value: true, type: 'toggle', label: 'Mirror',
    help: 'Reflect alternate blocks, including the cells within each petal.' },
};
let cy = 0, cz = 0;
function frame() {
  const c = centres('rose')[0];
  if (c) { cy = c[1]; cz = c[2]; }
}
function warp(q, t, P) {
  if (!q.is('rose') || q.sector < 0) return;
  const repeats = P.repeats === 'two' ? 2 : P.repeats === 'four' ? 4 : P.repeats === 'eight' ? 8 : 16;
  const n = 16 / repeats, p = q.sector, block = floor(p / n);
  const reflect = P.mirror && block % 2, local = p % n;
  const target = round(P.offset) + (reflect ? n - 1 - local : local);
  const base = p * TAU / 16, a = (target - p) * TAU / 16;
  let y = q.Y - cy, z = q.Z - cz;
  if (reflect) {
    const along = y * cos(base) + z * sin(base), side = z * cos(base) - y * sin(base);
    y = along * cos(base) + side * sin(base); z = along * sin(base) - side * cos(base);
  }
  const Y = cy + y * cos(a) - z * sin(a), Z = cz + z * cos(a) + y * sin(a);
  move(q, q.lx, q.sy ? 0.5 + (Y - q.oy) / (2 * q.sy) : 0.5,
    q.sz ? 0.5 + (Z - q.oz) / (2 * q.sz) : 0.5);
  slide(q, toward(q, 'along'));
}
